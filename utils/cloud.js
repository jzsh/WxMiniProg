// utils/cloud.js - 云开发数据库操作工具

const db = wx.cloud.database();

// ==================== 日记集合 ====================

// 添加日记
function addDiary(diary) {
  return db.collection('diaries').add({
    data: {
      title: diary.title,
      detail: diary.detail,
      date: diary.date,
      images: diary.images || [],
      coverImage: diary.coverImage || '',
      tag: diary.tag || '纪念日',
      mood: diary.mood || '',
      weather: diary.weather || '',
      location: diary.location || '',
      locationData: diary.locationData || null,
      content: diary.content || [],
      likeCount: 0,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  }).then(res => {
    // 记录操作日志
    _logOperationInternal('add', 'diary', res._id, {
      title: diary.title,
      date: diary.date
    });
    return res;
  });
}

// 更新日记
function updateDiary(id, diary) {
  const updateData = {
    title: diary.title,
    detail: diary.detail,
    date: diary.date,
    images: diary.images || [],
    coverImage: diary.coverImage || '',
    mood: diary.mood || '',
    weather: diary.weather || '',
    location: diary.location || '',
    content: diary.content || [],
    updatedAt: db.serverDate()
  };
  
  // 如果 locationData 是对象，需要先删除再设置（解决 null 无法更新子字段的问题）
  if (diary.locationData && diary.locationData.latitude) {
    // 先删除旧字段（如果之前是 null）
    return db.collection('diaries').doc(id).update({
      data: {
        locationData: db.command.remove()
      }
    }).then(() => {
      // 再设置新值
      updateData.locationData = diary.locationData;
      return db.collection('diaries').doc(id).update({ data: updateData }).then(res => {
        // 记录操作日志
        _logOperationInternal('update', 'diary', id, {
          title: diary.title,
          date: diary.date
        });
        return res;
      });
    });
  } else {
    // 否则直接设为 null
    updateData.locationData = diary.locationData || null;
    return db.collection('diaries').doc(id).update({ data: updateData }).then(res => {
      // 记录操作日志
      _logOperationInternal('update', 'diary', id, {
        title: diary.title,
        date: diary.date
      });
      return res;
    });
  }
}

// 删除日记
function deleteDiary(id) {
  // 先获取日记内容，以便记录日志
  return db.collection('diaries').doc(id).get().then(diaryRes => {
    const diaryData = diaryRes.data;
    // 删除日记
    return db.collection('diaries').doc(id).remove().then(res => {
      // 记录操作日志
      _logOperationInternal('delete', 'diary', id, {
        title: diaryData.title,
        date: diaryData.date
      });
      return res;
    });
  });
}

// 获取日记列表（按日期倒序）
function getDiaryList(pageSize, pageNum) {
  pageSize = pageSize || 20;
  pageNum = pageNum || 1;
  return db.collection('diaries')
    .orderBy('date', 'desc')
    .orderBy('createdAt', 'desc')
    .skip((pageNum - 1) * pageSize)
    .limit(pageSize)
    .get();
}

// 获取单篇日记
function getDiary(id) {
  return db.collection('diaries').doc(id).get();
}

// ==================== 评论集合 ====================

// 添加评论（不再冗余存昵称/头像，只存 userId，显示时从 users 表查）
function addComment(diaryId, comment) {
  return db.collection('comments').add({
    data: {
      diaryId: diaryId,
      content: comment.content,
      userId: wx.getStorageSync('userId') || '',
      likeCount: 0,
      createdAt: db.serverDate()
    }
  }).then(res => {
    // 记录操作日志
    _logOperationInternal('add', 'comment', res._id, {
      diaryId: diaryId,
      contentPreview: comment.content ? (comment.content.length > 20 ? comment.content.substring(0, 20) + '...' : comment.content) : '',
      userId: wx.getStorageSync('userId') || ''
    });
    return res;
  });
}

// 获取某篇日记的评论
function getComments(diaryId) {
  return db.collection('comments')
    .where({ diaryId: diaryId })
    .orderBy('createdAt', 'desc')
    .get();
}

// 删除某篇日记的所有评论
function deleteCommentsByDiaryId(diaryId) {
  const _ = db.command;
  // 先获取要删除的评论，以便记录日志
  return db.collection('comments').where({ diaryId: diaryId }).get().then(commentsRes => {
    const comments = commentsRes.data || [];
    // 删除评论
    return db.collection('comments').where({ diaryId: diaryId }).remove().then(res => {
      // 记录操作日志（批量删除）
      if (comments.length > 0) {
        _logOperationInternal('delete', 'comment_batch', '', {
          diaryId: diaryId,
          count: comments.length,
          commentsPreview: comments.map(c => ({
            id: c._id,
            contentPreview: c.content ? (c.content.length > 20 ? c.content.substring(0, 20) + '...' : c.content) : ''
          }))
        });
      }
      return res;
    });
  });
}

// 清理孤儿评论：查找 comments 中 diaryId 在 diaries 里不存在的记录并删除
function cleanOrphanComments() {
  const dbTemp = wx.cloud.database();
  return dbTemp.collection('comments').limit(100).get().then(res => {
    const comments = res.data || [];
    if (comments.length === 0) return { cleaned: 0 };
    // 提取所有不重复的 diaryId
    const diaryIds = [...new Set(comments.map(c => c.diaryId))];
    // 查询这些 diaryId 在 diaries 集合中是否存在
    return dbTemp.collection('diaries').where({
      _id: db.command.in(diaryIds)
    }).limit(100).get().then(diaryRes => {
      const existingIds = new Set((diaryRes.data || []).map(d => d._id));
      const orphans = comments.filter(c => !existingIds.has(c.diaryId));
      if (orphans.length === 0) return { cleaned: 0 };
      console.warn('[孤儿评论清理] 发现 ' + orphans.length + ' 条孤儿评论，所属日记已不存在，自动删除');
      // 逐条删除（小程序端 where remove 一次只能删20条）
      const tasks = orphans.map(c =>
        dbTemp.collection('comments').doc(c._id).remove().catch(() => {})
      );
      return Promise.all(tasks).then(() => ({ cleaned: orphans.length }));
    });
  });
}

// ==================== 云存储 ====================

// 根据文件内容生成指纹哈希（用于去重）
// 读取文件的头部和尾部数据 + 文件大小，生成确定性标识
function _fileFingerprint(filePath) {
  return new Promise((resolve) => {
    const fs = wx.getFileSystemManager();
    try {
      const stat = fs.statSync(filePath);
      const size = stat.size;

      // 读取文件头部（最多2KB）和尾部（最多2KB）
      const headSize = Math.min(2048, size);
      const tailSize = Math.min(2048, Math.max(0, size - 2048));
      const tailOffset = Math.max(0, size - 2048);

      let headBuf = null;
      let tailBuf = null;

      try { headBuf = fs.readFileSync(filePath, null, 0, headSize); } catch (e) {}
      try {
        if (tailOffset > headSize) {
          tailBuf = fs.readFileSync(filePath, null, tailOffset, tailSize);
        }
      } catch (e) {}

      // 将文件大小 + 头部 + 尾部数据混合生成哈希
      let hash = size;
      const mix = (buf) => {
        if (!buf) return;
        // 采样混合：每隔若干字节取一个，避免长文件计算慢
        const step = Math.max(1, Math.floor(buf.byteLength / 256));
        for (let i = 0; i < buf.byteLength; i += step) {
          hash = ((hash << 5) - hash + buf[i]) | 0; // 简单 DJB2 变体
        }
      };

      mix(headBuf);
      mix(tailBuf);

      // 转为无符号十六进制字符串
      const hex = (hash >>> 0).toString(16).padStart(8, '0');
      resolve(hex);
    } catch (e) {
      // 读取失败则回退到随机名
      console.warn('[cloud] 文件指纹计算失败，回退随机名:', e);
      resolve(Date.now().toString(16) + Math.random().toString(36).substr(2, 4));
    }
  });
}

// 上传图片到云存储（去重版：相同内容的图片只存一份）
async function uploadImage(filePath) {
  const ext = filePath.match(/\.[^.]+$/)[0] || '.jpg';
  const fingerprint = await _fileFingerprint(filePath);
  const cloudPath = 'images/' + fingerprint + ext;

  const uploadRes = await wx.cloud.uploadFile({
    cloudPath: cloudPath,
    filePath: filePath,
    config: { uploadType: 'storage' }
  });
  return uploadRes;
}

// 批量上传图片（去重版）
async function uploadImages(filePaths) {
  const results = [];
  for (const fp of filePaths) {
    results.push(await uploadImage(fp));
  }
  return results;
}

// 删除云存储文件
function deleteFile(fileID) {
  return wx.cloud.deleteFile({
    fileList: [fileID]
  });
}

// 将 cloud:// 文件ID列表转为临时 HTTP 链接（通过云函数绕过存储权限限制）
function getTempFileURLs(fileList) {
  console.log('getTempFileURLs 被调用，原始文件列表:', fileList);
  const cloudFiles = fileList.filter(f => f && f.startsWith('cloud://'));
  console.log('过滤后的 cloud:// 文件:', cloudFiles);
  if (cloudFiles.length === 0) {
    console.log('没有 cloud:// 文件，直接返回原列表');
    return Promise.resolve(fileList);
  }
  // 先尝试客户端 API
  console.log('尝试客户端 API wx.cloud.getTempFileURL...');
  return wx.cloud.getTempFileURL({ fileList: cloudFiles }).then(res => {
    console.log('客户端 API 响应:', res);
    // 检查是否有失败的
    const failed = res.fileList.filter(item => item.status !== 0);
    if (failed.length === 0) {
      console.log('客户端 API 全部成功');
      const urlMap = {};
      res.fileList.forEach(item => { urlMap[item.fileID] = item.tempFileURL; });
      const result = fileList.map(f => urlMap[f] || f);
      console.log('最终返回的URL列表:', result);
      return result;
    }
    // 客户端 API 部分失败，回退到云函数
    console.warn(`客户端获取临时链接部分失败 (${failed.length} 个)，尝试云函数...`, failed);
    return _getTempURLViaCloudFunction(cloudFiles).then(urlMap => {
      const result = fileList.map(f => urlMap[f] || f);
      console.log('云函数返回的最终URL列表:', result);
      return result;
    });
  }).catch(err => {
    console.warn('客户端获取临时链接失败，尝试云函数:', err.message);
    return _getTempURLViaCloudFunction(cloudFiles).then(urlMap => {
      const result = fileList.map(f => urlMap[f] || f);
      console.log('云函数返回的最终URL列表:', result);
      return result;
    });
  });
}

// 通过云函数获取临时链接（管理员权限，不受存储安全规则限制）
function _getTempURLViaCloudFunction(cloudFiles) {
  console.log('通过云函数获取临时链接，文件列表:', cloudFiles);
  return wx.cloud.callFunction({
    name: 'getTempURL',
    data: { fileList: cloudFiles }
  }).then(res => {
    console.log('云函数调用响应:', res);
    if (res.result && res.result.code === 0) {
      console.log('云函数返回成功，数据:', res.result.data);
      const urlMap = {};
      res.result.data.forEach(item => { 
        console.log(`文件ID: ${item.fileID} => 临时URL: ${item.tempFileURL}`);
        urlMap[item.fileID] = item.tempFileURL; 
      });
      return urlMap;
    }
    console.error('云函数获取临时链接失败:', res.result);
    const urlMap = {};
    cloudFiles.forEach(f => { urlMap[f] = f; });
    console.warn('云函数失败，返回原始文件ID映射:', urlMap);
    return urlMap;
  }).catch(err => {
    console.error('云函数调用失败:', err);
    console.error('错误详情:', err.errMsg, err.errCode, err.stack);
    const urlMap = {};
    cloudFiles.forEach(f => { urlMap[f] = f; });
    console.warn('云函数调用异常，返回原始文件ID映射:', urlMap);
    return urlMap;
  });
}

// ==================== 便利贴相关集合 ====================

// 获取用户的便利贴列表
function getStickyNotes() {
  return db.collection('sticky_notes')
    .orderBy('createTime', 'desc')
    .get();
}

// 添加便利贴
function addStickyNote(note) {
  return db.collection('sticky_notes').add({
    data: {
      color: note.color || '#FFF9C4',
      text: note.text,
      createTime: db.serverDate()
    }
  }).then(res => {
    // 记录操作日志
    _logOperationInternal('add', 'sticky_note', res._id, {
      textPreview: note.text ? (note.text.length > 30 ? note.text.substring(0, 30) + '...' : note.text) : '',
      color: note.color || '#FFF9C4'
    });
    return res;
  });
}

// 删除便利贴
function deleteStickyNote(id) {
  // 先获取便利贴内容，以便记录日志
  return db.collection('sticky_notes').doc(id).get().then(noteRes => {
    const noteData = noteRes.data;
    // 删除便利贴
    return db.collection('sticky_notes').doc(id).remove().then(res => {
      // 记录操作日志
      _logOperationInternal('delete', 'sticky_note', id, {
        textPreview: noteData.text ? (noteData.text.length > 30 ? noteData.text.substring(0, 30) + '...' : noteData.text) : '',
        color: noteData.color || '#FFF9C4'
      });
      return res;
    });
  });
}

// 获取用户的纪念日列表
function getAnniversaries() {
  return db.collection('anniversaries')
    .orderBy('date', 'asc')
    .get();
}

// 添加纪念日
function addAnniversary(anniversary) {
  return db.collection('anniversaries').add({
    data: {
      name: anniversary.name,
      date: anniversary.date,
      icon: anniversary.icon || '🎉',
      createTime: db.serverDate()
    }
  }).then(res => {
    // 记录操作日志
    _logOperationInternal('add', 'anniversary', res._id, {
      name: anniversary.name,
      date: anniversary.date,
      icon: anniversary.icon || '🎉'
    });
    return res;
  });
}

// 删除纪念日
function deleteAnniversary(id) {
  // 先获取纪念日内容，以便记录日志
  return db.collection('anniversaries').doc(id).get().then(anniversaryRes => {
    const anniversaryData = anniversaryRes.data;
    // 删除纪念日
    return db.collection('anniversaries').doc(id).remove().then(res => {
      // 记录操作日志
      _logOperationInternal('delete', 'anniversary', id, {
        name: anniversaryData.name,
        date: anniversaryData.date,
        icon: anniversaryData.icon || '🎉'
      });
      return res;
    });
  });
}

// 获取用户的快捷入口列表
function getQuickEntries() {
  return db.collection('quick_entries')
    .orderBy('createTime', 'asc')
    .get();
}

// 添加快捷入口
function addQuickEntry(entry) {
  return db.collection('quick_entries').add({
    data: {
      icon: entry.icon || '📌',
      name: entry.name,
      page: entry.page || '',
      createTime: db.serverDate()
    }
  }).then(res => {
    // 记录操作日志
    _logOperationInternal('add', 'quick_entry', res._id, {
      name: entry.name,
      icon: entry.icon || '📌',
      page: entry.page || ''
    });
    return res;
  });
}

// 删除快捷入口
function deleteQuickEntry(id) {
  // 先获取快捷入口内容，以便记录日志
  return db.collection('quick_entries').doc(id).get().then(entryRes => {
    const entryData = entryRes.data;
    // 删除快捷入口
    return db.collection('quick_entries').doc(id).remove().then(res => {
      // 记录操作日志
      _logOperationInternal('delete', 'quick_entry', id, {
        name: entryData.name,
        icon: entryData.icon || '📌',
        page: entryData.page || ''
      });
      return res;
    });
  });
}

// 获取用户的爱好标签列表
function getHobbies() {
  return db.collection('hobbies')
    .orderBy('createTime', 'asc')
    .get();
}

// 添加爱好标签
function addHobby(hobby) {
  return db.collection('hobbies').add({
    data: {
      name: hobby.name,
      createTime: db.serverDate()
    }
  }).then(res => {
    // 记录操作日志
    _logOperationInternal('add', 'hobby', res._id, {
      name: hobby.name
    });
    return res;
  });
}

// 删除爱好标签
function deleteHobby(id) {
  // 先获取爱好标签内容，以便记录日志
  return db.collection('hobbies').doc(id).get().then(hobbyRes => {
    const hobbyData = hobbyRes.data;
    // 删除爱好标签
    return db.collection('hobbies').doc(id).remove().then(res => {
      // 记录操作日志
      _logOperationInternal('delete', 'hobby', id, {
        name: hobbyData.name
      });
      return res;
    });
  });
}

// ==================== 备忘录集合 ====================

// 获取用户的备忘录列表
function getMemos() {
  return db.collection('memos')
    .orderBy('createdAt', 'desc')
    .get();
}

// 添加备忘录
function addMemo(memo) {
  return db.collection('memos').add({
    data: {
      title: memo.title,
      content: memo.content || '',
      color: memo.color || '#FFF9C4',
      createdAt: db.serverDate()
    }
  }).then(res => {
    _logOperationInternal('add', 'memo', res._id, {
      title: memo.title
    });
    return res;
  });
}

// 删除备忘录
function deleteMemo(id) {
  return db.collection('memos').doc(id).get().then(memoRes => {
    const memoData = memoRes.data;
    return db.collection('memos').doc(id).remove().then(res => {
      _logOperationInternal('delete', 'memo', id, {
        title: memoData.title
      });
      return res;
    });
  });
}

// ==================== 小目标集合 ====================

// 获取用户的小目标列表
function getGoals() {
  return db.collection('goals')
    .orderBy('createdAt', 'desc')
    .get();
}

// 添加小目标
function addGoal(goal) {
  return db.collection('goals').add({
    data: {
      title: goal.title,
      description: goal.description || '',
      deadline: goal.deadline || '',
      completed: false,
      createdAt: db.serverDate()
    }
  }).then(res => {
    _logOperationInternal('add', 'goal', res._id, {
      title: goal.title,
      deadline: goal.deadline || ''
    });
    return res;
  });
}

// 更新小目标完成状态
function updateGoalStatus(id, completed) {
  return db.collection('goals').doc(id).update({
    data: {
      completed: completed,
      updatedAt: db.serverDate()
    }
  }).then(res => {
    _logOperationInternal('update', 'goal', id, {
      action: completed ? '完成' : '取消完成'
    });
    return res;
  });
}

// 删除小目标
function deleteGoal(id) {
  return db.collection('goals').doc(id).get().then(goalRes => {
    const goalData = goalRes.data;
    return db.collection('goals').doc(id).remove().then(res => {
      _logOperationInternal('delete', 'goal', id, {
        title: goalData.title
      });
      return res;
    });
  });
}

// ==================== 健康记录集合 ====================

// 获取用户的健康记录列表
function getPeriodRecords() {
  return db.collection('period_records')
    .orderBy('createTime', 'desc')
    .get();
}

// 添加健康记录
function addPeriodRecord(record) {
  return db.collection('period_records').add({
    data: {
      type: record.type,
      startDate: record.startDate,
      endDate: record.endDate || record.startDate,
      createTime: db.serverDate()
    }
  }).then(res => {
    const typeNames = { period: '经期', intercourse: '性生活', ovulation: '排卵期' };
    _logOperationInternal('add', 'period_record', res._id, {
      type: record.type,
      typeName: typeNames[record.type] || record.type,
      startDate: record.startDate,
      endDate: record.endDate || record.startDate
    });
    return res;
  });
}

// 删除单条健康记录
function deletePeriodRecord(id) {
  return db.collection('period_records').doc(id).get().then(recRes => {
    const recData = recRes.data;
    return db.collection('period_records').doc(id).remove().then(res => {
      _logOperationInternal('delete', 'period_record', id, {
        type: recData.type,
        startDate: recData.startDate,
        endDate: recData.endDate
      });
      return res;
    });
  });
}

// 删除日期范围内的健康记录
function deletePeriodRecordsInRange(start, end) {
  const _ = db.command;
  return db.collection('period_records')
    .where({
      startDate: _.lte(end),
      endDate: _.gte(start)
    })
    .limit(100)
    .get()
    .then(res => {
      const records = res.data || [];
      if (records.length === 0) return { deletedCount: 0 };
      const tasks = records.map(r => db.collection('period_records').doc(r._id).remove());
      return Promise.all(tasks).then(() => {
        _logOperationInternal('delete', 'period_record_batch', '', {
          count: records.length,
          rangeStart: start,
          rangeEnd: end
        });
        return { deletedCount: records.length };
      });
    });
}

// ==================== 收藏集合 ====================

// 获取用户的收藏列表
function getFavorites() {
  return db.collection('favorites')
    .orderBy('createdAt', 'desc')
    .get();
}

// 添加收藏
function addFavorite(diaryId, diaryData) {
  return db.collection('favorites').add({
    data: {
      diaryId: diaryId,
      title: diaryData.title || '',
      detail: diaryData.detail || '',
      date: diaryData.date || '',
      tag: diaryData.tag || '',
      mood: diaryData.mood || '',
      coverImage: diaryData.coverImage || '',
      createdAt: db.serverDate()
    }
  }).then(res => {
    _logOperationInternal('add', 'favorite', res._id, {
      diaryId: diaryId,
      title: diaryData.title || ''
    });
    return res;
  });
}

// 删除收藏
function deleteFavorite(id) {
  return db.collection('favorites').doc(id).get().then(favRes => {
    const favData = favRes.data;
    return db.collection('favorites').doc(id).remove().then(res => {
      _logOperationInternal('delete', 'favorite', id, {
        diaryId: favData.diaryId || '',
        title: favData.title || ''
      });
      return res;
    });
  });
}

// 根据日记ID删除收藏
function deleteFavoriteByDiaryId(diaryId) {
  return db.collection('favorites')
    .where({ diaryId: diaryId })
    .limit(1)
    .get()
    .then(res => {
      if (res.data && res.data.length > 0) {
        return deleteFavorite(res.data[0]._id);
      }
      return Promise.resolve();
    });
}

// ==================== 情侣100件事集合 ====================

// 获取情侣100件事的完成进度
function getCoupleThingsProgress() {
  return db.collection('couple_things_progress')
    .orderBy('thingIndex', 'asc')
    .get();
}

// 更新单件事的完成状态
function updateCoupleThingProgress(thingIndex, completed, thingText) {
  // 先查询是否已存在该记录
  return db.collection('couple_things_progress')
    .where({ thingIndex: thingIndex })
    .limit(1)
    .get()
    .then(res => {
      if (res.data && res.data.length > 0) {
        // 已存在，更新状态
        const id = res.data[0]._id;
        const oldCompleted = res.data[0].completed;
        return db.collection('couple_things_progress').doc(id).update({
          data: {
            completed: completed,
            updateTime: db.serverDate()
          }
        }).then(updateRes => {
          // 记录操作日志
          _logOperationInternal('update', 'couple_thing', id, {
            thingIndex: thingIndex,
            thingText: thingText || res.data[0].thingText,
            oldCompleted: oldCompleted,
            newCompleted: completed,
            action: completed ? '勾选完成' : '取消勾选'
          });
          return updateRes;
        });
      } else {
        // 不存在，创建新记录（包含事项描述）
        return db.collection('couple_things_progress').add({
          data: {
            thingIndex: thingIndex,
            thingText: thingText,  // 事项描述
            completed: completed,
            createTime: db.serverDate(),
            updateTime: db.serverDate()
          }
        }).then(addRes => {
          // 记录操作日志
          _logOperationInternal('add', 'couple_thing', addRes._id, {
            thingIndex: thingIndex,
            thingText: thingText,
            completed: completed,
            action: completed ? '勾选完成' : '创建未完成'
          });
          return addRes;
        });
      }
    });
}

// 重置所有进度（清空所有记录）
function resetCoupleThingsProgress() {
  return db.collection('couple_things_progress').limit(100).get()
    .then(res => {
      const items = res.data || [];
      const deleteTasks = items.map(item => 
        db.collection('couple_things_progress').doc(item._id).remove()
      );
      return Promise.all(deleteTasks).then(() => {
        // 记录批量删除操作日志
        if (items.length > 0) {
          _logOperationInternal('delete', 'couple_thing_batch', '', {
            count: items.length,
            itemsPreview: items.map(item => ({
              thingIndex: item.thingIndex,
              thingText: item.thingText,
              completed: item.completed
            }))
          });
        }
        return { deletedCount: items.length };
      });
    });
}

// ==================== 用户资料集合 ====================

// 更新用户资料（使用本地存储的 userId 作为文档 _id）
function updateUserProfile(userId, profile) {
  if (!userId) {
    return Promise.reject(new Error('userId 不能为空'));
  }
  // 构建更新数据，排除 undefined 字段
  const updateData = {
    avatarUrl: profile.avatarUrl || '',
    nickName: profile.nickName || '',
    gender: profile.gender !== undefined ? profile.gender : 2,
    phone: profile.phone || '',
    age: profile.age !== undefined ? profile.age : null,
    updatedAt: db.serverDate()
  };
  
  // 检查用户是否已存在
  return db.collection('users').doc(userId).get().then(res => {
    if (res.data) {
      // 存在，更新
      return db.collection('users').doc(userId).update({
        data: updateData
      }).then(updateRes => {
        // 记录操作日志
        logOperation(userId, {
          operationType: 'update',
          entityType: 'user',
          entityId: userId,
          entityContent: {
            nickName: profile.nickName || '',
            gender: profile.gender !== undefined ? profile.gender : 2,
            hasAvatar: !!profile.avatarUrl,
            hasPhone: !!profile.phone,
            hasAge: profile.age !== undefined
          }
        });
        return updateRes;
      });
    } else {
      // 不存在，创建新文档，同时设置创建时间
      updateData._id = userId;
      updateData.openid = userId;
      updateData.createdAt = db.serverDate();
      return db.collection('users').add({
        data: updateData
      }).then(addRes => {
        // 记录操作日志
        logOperation(userId, {
          operationType: 'add',
          entityType: 'user',
          entityId: userId,
          entityContent: {
            nickName: profile.nickName || '',
            gender: profile.gender !== undefined ? profile.gender : 2,
            hasAvatar: !!profile.avatarUrl,
            hasPhone: !!profile.phone,
            hasAge: profile.age !== undefined
          }
        });
        return addRes;
      });
    }
  }).catch(err => {
    // 如果文档不存在，get 会抛出错误，此时创建新文档
    if (err.errCode === -1 || err.errMsg && err.errMsg.includes('not exist')) {
      updateData._id = userId;
      updateData.openid = userId;
      updateData.createdAt = db.serverDate();
      return db.collection('users').add({
        data: updateData
      }).then(addRes => {
        // 记录操作日志
        logOperation(userId, {
          operationType: 'add',
          entityType: 'user',
          entityId: userId,
          entityContent: {
            nickName: profile.nickName || '',
            gender: profile.gender !== undefined ? profile.gender : 2,
            hasAvatar: !!profile.avatarUrl,
            hasPhone: !!profile.phone,
            hasAge: profile.age !== undefined
          }
        });
        return addRes;
      });
    }
    throw err;
  });
}

// 获取用户资料
function getUserProfile(userId) {
  if (!userId) {
    return Promise.reject(new Error('userId 不能为空'));
  }
  return db.collection('users').doc(userId).get();
}

// ==================== 操作日志集合 ====================

// 记录操作日志
function logOperation(userId, operation) {
  if (!userId) {
    console.warn('logOperation: userId 为空，跳过日志记录');
    return Promise.resolve();
  }
  
  const logData = {
    userId: userId,
    operationType: operation.operationType || 'unknown', // add, delete, update
    entityType: operation.entityType || 'unknown', // diary, anniversary, comment, etc.
    entityId: operation.entityId || '',
    entityContent: operation.entityContent || {}, // 具体操作内容
    operationTime: db.serverDate(),
    ipAddress: operation.ipAddress || '',
    deviceInfo: operation.deviceInfo || {},
    additionalInfo: operation.additionalInfo || {}
  };
  
  return db.collection('operation_logs').add({
    data: logData
  }).catch(err => {
    console.error('记录操作日志失败:', err);
    // 不要因为日志记录失败而影响主操作
    return Promise.resolve();
  });
}

// 获取用户的操作日志
function getUserOperationLogs(userId, limit = 50, page = 1) {
  if (!userId) {
    return Promise.reject(new Error('userId 不能为空'));
  }
  return db.collection('operation_logs')
    .where({ userId: userId })
    .orderBy('operationTime', 'desc')
    .skip((page - 1) * limit)
    .limit(limit)
    .get();
}

// 获取所有操作日志（管理员用）
function getAllOperationLogs(limit = 50, page = 1) {
  return db.collection('operation_logs')
    .orderBy('operationTime', 'desc')
    .skip((page - 1) * limit)
    .limit(limit)
    .get();
}

// 获取用户的操作日志（调试版，不排序，用于检查索引问题）
function getUserOperationLogsDebug(userId, limit = 50, page = 1) {
  if (!userId) {
    return Promise.reject(new Error('userId 不能为空'));
  }
  return db.collection('operation_logs')
    .where({ userId: userId })
    .skip((page - 1) * limit)
    .limit(limit)
    .get();
}

// 获取当前用户ID（从本地存储）
function getCurrentUserId() {
  try {
    return wx.getStorageSync('userId') || '';
  } catch (err) {
    console.error('获取用户ID失败:', err);
    return '';
  }
}

// 记录操作日志（内部使用）
function _logOperationInternal(operationType, entityType, entityId, entityContent, additionalInfo = {}) {
  const userId = getCurrentUserId();
  if (!userId) {
    console.warn('无法获取用户ID，跳过操作日志记录');
    return Promise.resolve();
  }
  
  const logData = {
    userId: userId,
    operationType: operationType,
    entityType: entityType,
    entityId: entityId || '',
    entityContent: entityContent || {},
    operationTime: db.serverDate(),
    additionalInfo: additionalInfo
  };
  
  return db.collection('operation_logs').add({
    data: logData
  }).catch(err => {
    console.error('记录操作日志失败:', err);
    return Promise.resolve();
  });
}

module.exports = {
  addDiary,
  updateDiary,
  deleteDiary,
  getDiaryList,
  getDiary,
  addComment,
  getComments,
  deleteCommentsByDiaryId,
  cleanOrphanComments,
  uploadImage,
  uploadImages,
  _fileFingerprint,
  deleteFile,
  getTempFileURLs,
  // 便利贴相关
  getStickyNotes,
  addStickyNote,
  deleteStickyNote,
  getAnniversaries,
  addAnniversary,
  deleteAnniversary,
  getQuickEntries,
  addQuickEntry,
  deleteQuickEntry,
  getHobbies,
  addHobby,
  deleteHobby,
  // 备忘录相关
  getMemos,
  addMemo,
  deleteMemo,
  // 小目标相关
  getGoals,
  addGoal,
  updateGoalStatus,
  deleteGoal,
  // 健康记录相关
  getPeriodRecords,
  addPeriodRecord,
  deletePeriodRecord,
  deletePeriodRecordsInRange,
  // 收藏相关
  getFavorites,
  addFavorite,
  deleteFavorite,
  deleteFavoriteByDiaryId,
  // 情侣100件事相关
  getCoupleThingsProgress,
  updateCoupleThingProgress,
  resetCoupleThingsProgress,
  // 用户资料相关
  updateUserProfile,
  getUserProfile,
  // 操作日志相关
  logOperation,
  getUserOperationLogs,
  getAllOperationLogs,
  getUserOperationLogsDebug,
  // 数据导出（公共函数，任何页面可调用，不跳转）
  doExport,
  // 数据导入（公共函数，不跳转）
  doImport,
  // 数据清除（公共函数，导入和清除数据共用）
  clearAllData
};

// ==================== 公共导出功能 ====================

// 执行数据导出（不跳转页面）
async function doExport() {
  console.log('[doExport] 开始执行导出...');
  const db = wx.cloud.database();
  const fs = wx.getFileSystemManager();
  const now = new Date();
  const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
  
  const baseDir = `${wx.env.USER_DATA_PATH}/export_${timestamp}`;
  try { fs.mkdirSync(baseDir, true); } catch(e) {}
  const imgDir = `${baseDir}/images`;
  try { fs.mkdirSync(imgDir, true); } catch(e) {}

  const logInfo = {
    localTime: now.toLocaleString('zh-CN'),
    summary: { totalRecords: 0, totalImages: 0, successImages: 0, failedImages: 0, jsonSize: '' },
    collectionStats: {},
    imageErrors: [],
    dataErrors: [],
    warnings: []
  };

  wx.showLoading({ title: '正在导出数据...', mask: true });

  try {
    const collections = ['diaries','comments','sticky_notes','anniversaries','quick_entries','hobbies','couple_things_progress','photos','users','memos','goals','period_records','favorites'];
    let completedCount = 0;
    const exportData = { collections: {}, images: [] };
    const allCloudFileIDs = new Set();

    for (const col of collections) {
      completedCount++;
      wx.showLoading({ title: `正在导出... (${completedCount}/${collections.length})`, mask: true });
      try {
        console.log(`[doExport] 正在查询集合: ${col}`);
        const data = await _fetchCollection(db, col);
        console.log(`[doExport] ${col} 查询结果: ${data ? data.length : 0} 条`);
        if (data && data.length > 0) {
          exportData.collections[col] = data;
          logInfo.collectionStats[col] = { count: data.length, status: 'ok' };
          for (const r of data) _extractCloud(r, allCloudFileIDs);
        } else {
          logInfo.collectionStats[col] = { count: 0, status: 'empty' };
        }
      } catch (err) {
        console.error(`[doExport] ${col} 查询失败:`, err);
        const msg = err.message || String(err);
        if (msg.includes('not exist')) logInfo.collectionStats[col] = { count: 0, status: 'not_exist' };
        else { logInfo.dataErrors.push({ collection: col, error: msg }); logInfo.collectionStats[col] = { count: 0, status: 'error', error: msg }; }
        exportData.collections[col] = [];
      }
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('[doExport] 所有集合查询完成', exportData.collections);

    // 导出图片
    const fileIDs = Array.from(allCloudFileIDs);
    logInfo.summary.totalImages = fileIDs.length;
    if (fileIDs.length > 0) {
      exportData.images = await _exportImages(fileIDs, imgDir, logInfo, getTempFileURLs);
    }
    logInfo.summary.successImages = exportData.images.filter(i=>i.status==='ok').length;
    logInfo.summary.failedImages = logInfo.imageErrors.length;

    const totalRecords = Object.values(exportData.collections).filter(Array.isArray).reduce((s,a)=>s+a.length,0);
    logInfo.summary.totalRecords = totalRecords;

    // 写文件
    exportData.exportTime = now.toISOString();
    exportData.version = '3.0';
    const jsonStr = JSON.stringify(exportData, null, 2);
    fs.writeFileSync(`${baseDir}/data.json`, jsonStr, 'utf8');
    logInfo.summary.jsonSize = `${(jsonStr.length/1024).toFixed(1)} KB`;
    _writeLog(logInfo, baseDir, fs);

    wx.hideLoading();

    // 显示结果
    let c = `✅ 导出成功！\n\n📊 统计:\n- 记录: ${totalRecords}条\n- 图片: ${logInfo.successImages}/${logInfo.totalImages}\n- 大小: ${logInfo.jsonSize}\n`;
    const nonEmpty = Object.entries(logInfo.collectionStats).filter(([,s])=>s.count>0);
    if (nonEmpty.length) { c += '\n📋 数据:\n'; const m={diaries:'日记',comments:'评论',sticky_notes:'便利贴',anniversaries:'纪念日',quick_entries:'快捷入口',hobbies:'爱好标签',couple_things_progress:'情侣事项',photos:'照片',users:'用户',memos:'备忘录',goals:'小目标',period_records:'健康记录',favorites:'收藏'}; nonEmpty.forEach(([n,s])=>c+=`  · ${m[n]||n}: ${s.count}条\n`); }
    if (logInfo.imageErrors.length > 0) { c += `\n⚠️ ${logInfo.imageErrors.length}张图失败:\n`; logInfo.imageErrors.slice(0,3).forEach(e=>c+=`  · ${e.displayName||e.fileID}\n  → ${e.reason}\n`); }
    c += '\n💡 点击下方查看';

    wx.showModal({ title: '📦 导出完成', content: c, showCancel: false, confirmText: '查看', success: () => _shareFolder(baseDir, timestamp, fs) });

  } catch (err) {
    wx.hideLoading(); console.error('导出出错:', err);
    wx.showToast({ title: `导出失败: ${err.message}`, icon: 'none', duration: 4000 });
  }
}

function _fetchCollection(database, name) {
  return new Promise((resolve, reject) => {
    console.log(`[_fetchCollection] 开始查询: ${name}`);
    database.collection(name).limit(1).get()
      .then(() => {
        const all=[], ps=20; // 客户端SDK单次查询硬上限20条
        let p=1, qc=0;  // ← 修复：改成 let
        const fp=()=>{if(qc>=5000){console.warn(`[_fetchCollection] ⚠️ ${name} 查询达到上限(5000次/约10万条)，返回 ${all.length} 条`); resolve(all);return;}qc++;
          database.collection(name).skip((p-1)*ps).limit(ps).get()
            .then(res=>{const d=res.data||[];console.log(`[_fetchCollection] ${name} 第${p}页: ${d.length} 条`); all.push(...d);if(d.length<ps){console.log(`[_fetchCollection] ${name} 完成，共 ${all.length} 条`); resolve(all);}else{p++;fp();}})
            .catch(err=>{console.error(`[_fetchCollection] ${name} 第${p}页失败:`, err); if(all.length>0)resolve(all);else reject(err);});};
        fp();})
      .catch(err=>{console.error(`[_fetchCollection] ${name} 初始查询失败:`, err); if(err.errMsg?.includes('not found')) resolve([]);else reject(err);});
  });
}

function _extractCloud(obj, set) {
  if (!obj || typeof obj!=='object') return;
  if (Array.isArray(obj)) { obj.forEach(o=>_extractCloud(o,set)); return; }
  for (const v of Object.values(obj)) {
    if (typeof v==='string'&&v.startsWith('cloud://')) set.add(v);
    else if (v&&typeof v==='object') _extractCloud(v,set);
  }
}

async function _exportImages(fileIDs, imgDir, logInfo, getTempURLs) {
  const results=[], batchSize=5;
  for (let i=0; i<fileIDs.length; i+=batchSize) {
    const batch=fileIDs.slice(i,i+batchSize);
    wx.showLoading({title:`导出图片...(${Math.min(i+batchSize,fileIDs.length)}/${fileIDs.length})`,mask:true});
    const promises=batch.map(async(fid,idx)=>{
      const dn=`[${fid.split('/').pop()||fid.substring(0,30)}]`;
      try{
        console.log(`[_exportImages] 开始处理图片: ${fid}`);
        let url=null;
        try{
          const r=await wx.cloud.getTempFileURL({fileList:[fid]});
          console.log(`[_exportImages] 客户端API返回:`, r);
          url=r.fileList[0].tempFileURL;
          console.log(`[_exportImages] 客户端API获取URL: ${url}`);
        }catch(e){
          console.warn(`[_exportImages] 客户端API失败，尝试云函数:`, e);
        }
        if(!url || url.trim()===''){
          console.warn(`[_exportImages] 客户端URL为空(url="${url}")，尝试云函数: ${fid}`);
          try{
            const urls=await getTempURLs([fid]);
            console.log(`[_exportImages] 云函数返回:`, urls);
            url=Array.isArray(urls)?urls[0]:null;
            console.log(`[_exportImages] 云函数获取URL: ${url}`);
          }catch(e2){
            console.error(`[_exportImages] 云函数也失败:`, e2);
          }
        }
        if(!url){
          console.error(`[_exportImages] 最终url为空，fileID: ${fid}`);
          throw new Error('获取临时链接失败');
        }
        console.log(`[_exportImages] 成功获取临时链接: ${url}`);
        const ext=(fid.toLowerCase().match(/\.(png|gif|webp|bmp|jpg)/)||['','.jpg'])[1];
        const name=`img_${String(i+idx).padStart(4,'0')}_${Date.now()}.${ext}`, path=`${imgDir}/${name}`;
        console.log(`[_exportImages] 开始下载: ${url} -> ${path}`);
        await new Promise((res,rej)=>{wx.downloadFile({url,filePath:path,success:r=>r.statusCode===200?res():rej(new Error(`HTTP${r.statusCode}`)),fail:rej});});
        console.log(`[_exportImages] 下载成功: ${path}`);
        return{originalFileID:fid,localPath:path,fileName:name,displayName:dn,status:'ok'};
      }catch(err){
        console.error(`[_exportImages] 处理失败:`, err);
        return{originalFileID:fid,displayName:dn,status:'failed',error:err.message||String(err)};
      }
    });
    const batchRes=await Promise.all(promises);
    batchRes.forEach(r=>{if(r.status==='ok')results.push(r);else logInfo.imageErrors.push({fileID:r.originalFileID,displayName:r.displayName,reason:r.error});});
    if(i+batchSize<fileIDs.length) await new Promise(r=>setTimeout(r,100));
  }
  return results;
}

function _writeLog(logInfo, baseDir, fs) {
  const l=[`觅光手记 导出报告`, `时间: ${logInfo.localTime}`, `记录: ${logInfo.summary.totalRecords}条`, `图片: ${logInfo.summary.successImages}/${logInfo.summary.totalImages}`, '', '各集合详情:'];
  for(const [name,stat] of Object.entries(logInfo.collectionStats)){l.push(`  ${stat.status==='ok'?'✅':stat.status==='empty'?'⬜':stat.status==='not_exist'?'➖':'❌'} ${name}: ${stat.count}条${stat.error?' ('+stat.error+')':''}`);}
  if(logInfo.imageErrors.length>0){l.push('','图片下载失败:');logInfo.imageErrors.forEach((e,i)=>{l.push(`  #${i+1} ${e.displayName}`);l.push(`    原因: ${e.reason}`);});}
  l.push('',`${baseDir.split('/').pop()}/\n├─ data.json (${logInfo.jsonSize})\n├─ export_log.txt\n└─ images/`);
  fs.writeFileSync(`${baseDir}/export_log.txt`,l.join('\n'),'utf8');
}

function _shareFolder(baseDir, ts, fs) {
  const p=`${baseDir}/data.json`;
  if(wx.shareFileMessage){wx.shareFileMessage({filePath:p,fileName:`觅光手记备份_${ts}.json`,success:()=>wx.showToast({title:'已分享',icon:'success'}),fail:()=>_showInfo(baseDir,ts,fs)});}
  else{_showInfo(baseDir,ts,fs);}
}

function _showInfo(baseDir,folderName,fs){
  let js='?KB',ic=0;try{js=(fs.statSync(`${baseDir}/data.json`).size/1024).toFixed(1)+' KB';}catch(_){}try{ic=(fs.readdirSync(`${baseDir}/images`)||[]).length;}catch(_){}
  wx.showModal({title:'📦 导出完成',content:`文件夹: ${folderName}\ndata.json (${js})\nimages/ (${ic}张)`,showCancel:false,confirmText:'我知道了'});
}

// ==================== 公共数据清除功能 ====================

// 清除所有集合的数据（导入前和"清除数据"功能共用）
const ALL_COLLECTIONS = ['users','diaries','anniversaries','sticky_notes',
  'quick_entries','hobbies','couple_things_progress','comments','photos',
  'memos','goals','period_records','favorites'];

async function clearAllData() {
  const db = wx.cloud.database();
  const results = { collections: {}, totalDeleted: 0, errors: [] };

  for (const col of ALL_COLLECTIONS) {
    wx.showLoading({ title: `清除 ${col}...`, mask: true });
    try {
      const data = await _fetchCollection(db, col);
      if (data && data.length > 0) {
        let deleted = 0;
        for (const doc of data) {
          try {
            await db.collection(col).doc(doc._id).remove();
            deleted++;
          } catch (e) {
            console.warn(`[clear] 删除失败 ${col}/${doc._id}:`, e);
            results.errors.push(`${col}/${doc._id}: ${e.errMsg || e.message}`);
          }
        }
        results.collections[col] = { count: deleted, status: 'ok' };
        results.totalDeleted += deleted;
        console.log(`[clear] ${col} 已删除 ${deleted}/${data.length} 条`);
      } else {
        results.collections[col] = { count: 0, status: 'empty' };
      }
    } catch (err) {
      const msg = err.message || String(err);
      results.collections[col] = { count: 0, status: 'error', error: msg };
      results.errors.push(`${col}: ${msg}`);
      if (msg.includes('not exist')) {
        results.collections[col] = { count: 0, status: 'not_exist' };
      }
    }
    // 短暂等待避免并发限制
    await new Promise(r => setTimeout(r, 100));
  }

  wx.hideLoading();
  return results;
}

// 执行数据导入（不跳转页面）
async function doImport(importData) {
  const db = wx.cloud.database();
  const DEPENDENCY_ORDER = ['users', 'diaries', 'anniversaries', 'sticky_notes',
    'quick_entries', 'hobbies', 'couple_things_progress', 'comments', 'photos',
    'memos', 'goals', 'period_records', 'favorites'];
  const collections = Object.keys(importData.collections);
  const sortedCols = DEPENDENCY_ORDER.filter(c => collections.includes(c))
    .concat(collections.filter(c => !DEPENDENCY_ORDER.includes(c)));

  let importedCount = 0, errorCount = 0, errors = [];

  try {
    for (const collectionName of sortedCols) {
      const records = importData.collections[collectionName];
      if (!Array.isArray(records) || records.length === 0) continue;

      wx.showLoading({ title: `导入 ${collectionName}...`, mask: true });

      try {
        for (const record of records) {
          try {
            await db.collection(collectionName).add({ data: record });
            importedCount++;
          } catch (addErr) {
            errorCount++;
            const msg = `${collectionName}/${record._id}: ${addErr.errMsg || addErr.message}`;
            errors.push(msg);
          }
        }
      } catch (colErr) {
        errorCount += records.length;
        errors.push(`集合${collectionName}异常: ${colErr.message}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    wx.hideLoading();
    return { summary: `✅ 成功: ${importedCount} 条\n❌ 失败: ${errorCount} 条`, errors };
  } catch (err) {
    wx.hideLoading();
    throw err;
  }
}


