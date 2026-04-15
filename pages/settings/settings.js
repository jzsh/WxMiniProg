// 默认头像使用本地占位（外部链接已失效）
const defaultAvatar = '';
const cloud = require('../../utils/cloud');
const userProfile = require('../../utils/userProfile');
// 引入数据库实例用于导入导出操作
const db = wx.cloud.database();

Page({
  data: {
    avatarUrl: defaultAvatar,
    nickName: '',
    gender: 2,
    genderArray: ['男', '女', '保密'],
    genderIndex: 2,
    phone: '',
    age: '',
    userId: ''
  },

  onLoad(options) {
    const userId = wx.getStorageSync('userId') || '';
    this.setData({ userId });
    
    // 通过统一模块加载用户资料
    userProfile.get().then(profile => {
      const avatarUrl = profile.avatarUrl || defaultAvatar;
      this.setData({
        avatarUrl,
        nickName: profile.nickName || '',
        gender: profile.gender !== undefined ? profile.gender : 2,
        genderIndex: profile.gender !== undefined ? profile.gender : 2,
        phone: profile.phone || '',
        age: profile.age !== undefined ? profile.age : ''
      });
      // 记录旧头像URL，换头像时删除旧文件
      this.data._oldAvatarUrl = avatarUrl;
    });

    // 暂存mode选项到实例，onLoad可能不会重复触发（页面缓存）
    console.log('[settings onLoad] options=', JSON.stringify(options));
    this._pendingMode = options.mode || '';
    this._autoStart = options.autoStart || '';
    console.log('[settings onLoad] _pendingMode=', this._pendingMode, '_autoStart=', this._autoStart);
    // 立即执行一次（首次加载）
    this._handlePendingMode();
  },

  onShow() {
    // 每次显示页面时都检查是否有待处理的导入/导出操作
    console.log('[settings onShow] _pendingMode=', this._pendingMode);
    this._handlePendingMode();
  },

  _handlePendingMode() {
    const mode = this._pendingMode;
    console.log('[settings _handlePendingMode] mode=', mode);
    if (!mode) return;
    this._pendingMode = ''; // 清除标志防止重复执行

    if (mode === 'export') {
      if (this._autoStart === 'true') {
        setTimeout(() => this._doExportData(), 300);
      } else {
        setTimeout(() => this.onExportData(), 500);
      }
    } else if (mode === 'import') {
      console.log('[settings _handlePendingMode] 准备调用 onImportData');
      setTimeout(() => this.onImportData(), 500);
    } else if (mode === 'clear') {
      setTimeout(() => this.onClearData(), 300);
    }
  },

  onChangeAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        // 只在本地预览，不上传。等用户点"保存"时再上传
        this.setData({
          avatarUrl: tempFilePath,
          _pendingAvatarPath: tempFilePath  // 记录待上传的本地路径
        });
      }
    });
  },

  onNickNameInput(e) {
    this.setData({ nickName: e.detail.value });
  },

  onGenderChange(e) {
    const index = parseInt(e.detail.value);
    this.setData({
      genderIndex: index,
      gender: index
    });
  },

  onPhoneInput(e) {
    this.setData({ phone: e.detail.value });
  },

  onAgeInput(e) {
    let age = e.detail.value.trim();
    // 只允许数字，且范围在 0-150 之间
    if (age === '') {
      this.setData({ age: '' });
      return;
    }
    const ageNum = parseInt(age, 10);
    if (isNaN(ageNum) || ageNum < 0 || ageNum > 150) {
      wx.showToast({ title: '请输入有效年龄（0-150）', icon: 'none' });
      return;
    }
    this.setData({ age: ageNum });
  },

  async onSave() {
    const { nickName, gender, phone, age } = this.data;
    if (!nickName.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...' });

    try {
      let avatarUrl = this.data.avatarUrl;
      const pendingPath = this.data._pendingAvatarPath;

      // 如果有待上传的头像（本地临时文件），先上传到云存储
      if (pendingPath) {
        const fingerprint = await cloud._fileFingerprint(pendingPath);
        const cloudPath = `avatars/${fingerprint}.jpg`;
        const uploadRes = await new Promise((resolve, reject) => {
          wx.cloud.uploadFile({
            cloudPath,
            filePath: pendingPath,
            success: resolve,
            fail: reject
          });
        });
        avatarUrl = uploadRes.fileID;

        // 上传成功后删除旧头像文件
        const oldAvatar = this.data._oldAvatarUrl || '';
        if (oldAvatar && oldAvatar.startsWith('cloud://') && oldAvatar !== avatarUrl) {
          console.log('[settings] 头像变更，删除旧文件:', oldAvatar);
          wx.cloud.deleteFile({ fileList: [oldAvatar] }).catch(err => {
            console.warn('[settings] 删除旧头像失败（不影响使用）:', err);
          });
        }

        // 清除待上传标记
        this.setData({ _pendingAvatarPath: '' });
      }

      // 构建用户资料对象
      const profile = {
        avatarUrl,
        nickName: nickName.trim(),
        gender,
        phone: phone.trim(),
        age: age !== '' ? parseInt(age, 10) : null
      };

      // 通过统一模块同时写入缓存 + 云端
      await userProfile.save(profile);
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ==================== 导入导出功能 ====================
  
  // 导出数据
  onExportData() {
    wx.showModal({
      title: '导出数据',
      content: '确定要导出所有数据吗？导出后将生成JSON文件。',
      confirmText: '导出',
      success: (res) => {
        if (res.confirm) {
          this._doExportData();
        }
      }
    });
  },

  // 执行导出操作
  async _doExportData() {
    wx.showLoading({ title: '正在导出数据...', mask: true });
    
    const fs = wx.getFileSystemManager();
    const now = new Date();
    const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}_${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
    
    // ========== 创建统一的导出文件夹 ==========
    const baseDir = `${wx.env.USER_DATA_PATH}/export_${timestamp}`;
    try { fs.mkdirSync(baseDir, true); } catch(e) { /* 目录可能已存在 */ }
    
    const imgDir = `${baseDir}/images`;
    try { fs.mkdirSync(imgDir, true); } catch(e) { /* 目录可能已存在 */ }

    // 日志信息收集器
    const logInfo = {
      exportTime: now.toISOString(),
      localTime: now.toLocaleString('zh-CN'),
      version: '3.0',
      summary: {
        totalRecords: 0,
        totalImages: 0,
        successImages: 0,
        failedImages: 0,
        jsonSize: '',
        imageSize: ''
      },
      collectionStats: {},
      imageErrors: [],
      dataErrors: [],
      warnings: []
    };

    try {
      // 需要导出的集合列表
      const allCollections = ['diaries', 'comments', 'sticky_notes', 'anniversaries', 
                             'quick_entries', 'hobbies', 'couple_things_progress', 'photos',
                             'users'];
      
      let completedCount = 0;
      const totalCount = allCollections.length;
      const allCloudFileIDs = new Set(); // 收集所有云文件ID
      
      // 逐个查询集合（避免并行请求导致超时）
      for (const collection of allCollections) {
        completedCount++;
        wx.showLoading({ title: `正在导出数据... (${completedCount}/${totalCount})`, mask: true });
        
        try {
          console.log(`开始导出集合: ${collection}`);
          
          // 设置单个集合的超时时间
          const data = await Promise.race([
            this._fetchAllFromCollection(collection),
            new Promise((_, reject) => setTimeout(() => reject(new Error('查询超时')), 10000))
          ]);
          
          if (data && Array.isArray(data)) {
            // 记录统计
            logInfo.collectionStats[collection] = {
              count: data.length,
              status: 'ok'
            };
            
            // 从记录中收集 cloud:// 文件ID
            this._collectCloudFileIDs(data, allCloudFileIDs);
            console.log(`${collection} 导出完成，共 ${data.length} 条记录`);
          } else {
            logInfo.collectionStats[collection] = { count: 0, status: 'empty' };
          }
          
        } catch (err) {
          const errMsg = err.message || String(err);
          console.warn(`导出集合 ${collection} 失败:`, err);
          
          if (errMsg.includes('CollectionNotExists') || errMsg.includes('not exist') || errMsg.includes('not found')) {
            logInfo.collectionStats[collection] = { count: 0, status: 'not_exist' };
            logInfo.warnings.push(`集合 ${collection} 不存在（这是正常的）`);
          } else {
            logInfo.dataErrors.push({ collection, error: errMsg });
            logInfo.collectionStats[collection] = { count: 0, status: 'error', error: errMsg };
          }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // ========== 图片导出 ==========
      const cloudFileIDs = Array.from(allCloudFileIDs);
      logInfo.summary.totalImages = cloudFileIDs.length;
      console.log(`发现 ${cloudFileIDs.length} 个云文件需要导出`);

      let exportedImages = [];

      if (cloudFileIDs.length > 0) {
        exportedImages = await this._exportImagesToFolder(cloudFileIDs, imgDir, logInfo);
      }

      logInfo.summary.successImages = exportedImages.filter(i => i.status === 'ok').length;
      logInfo.summary.failedImages = logInfo.imageErrors.length;

      // ========== 构建最终JSON数据并写入文件 ==========
      const exportData = {
        exportTime: now.toISOString(),
        version: '3.0',
        collections: {},
        images: exportedImages
      };

      // 再次获取完整数据用于JSON写入
      for (const collection of allCollections) {
        try {
          const data = await this._fetchAllFromCollection(collection).catch(() => []);
          exportData.collections[collection] = data;
        } catch(e) {
          exportData.collections[collection] = [];
        }
      }

      // 计算总记录数
      const totalRecords = Object.values(exportData.collections)
        .filter(Array.isArray)
        .reduce((sum, arr) => sum + arr.length, 0);
      logInfo.summary.totalRecords = totalRecords;

      // 写入 JSON 文件
      const jsonString = JSON.stringify(exportData, null, 2);
      const jsonFilePath = `${baseDir}/data.json`;
      fs.writeFileSync(jsonFilePath, jsonString, 'utf8');
      
      logInfo.summary.jsonSize = `${(jsonString.length / 1024).toFixed(1)} KB`;

      // ========== 写入日志文件 ==========
      this._writeExportLog(logInfo, baseDir, fs);

      wx.hideLoading();
      
      // 显示结果
      const content = this._buildExportSummary(logInfo);

      wx.showModal({
        title: '📦 导出完成',
        content,
        showCancel: false,
        confirmText: '查看文件',
        success: () => {
          this._shareExportedFolder(baseDir, timestamp);
          // 导出完成后自动返回上一页（"我的"页面）
          setTimeout(() => wx.navigateBack(), 1500);
        }
      });
      
      console.log('导出完成:', logInfo);
      
    } catch (err) {
      wx.hideLoading();
      console.error('导出过程出错:', err);
      wx.showToast({ title: `导出失败: ${err.message || '未知错误'}`, icon: 'none', duration: 4000 });
    }
  },

  // 写入导出日志文件
  _writeExportLog(logInfo, baseDir, fs) {
    const lines = [];
    lines.push('=' . repeat(60));
    lines.push('   觅光手记 - 数据导出报告');
    lines.push('=' . repeat(60));
    lines.push('');
    lines.push(`📅 导出时间: ${logInfo.localTime}`);
    lines.push(`📋 版本: v${logInfo.version}`);
    lines.push('');
    
    lines.push('-'.repeat(60));
    lines.push('📊 数据统计');
    lines.push('-'.repeat(60));
    lines.push('');
    lines.push(`总记录数: ${logInfo.summary.totalRecords} 条`);
    lines.push(`图片总数: ${logInfo.summary.totalImages} 张`);
    lines.push(`图片成功: ${logInfo.summary.successImages} 张`);
    lines.push(`图片失败: ${logInfo.summary.failedImages} 张`);
    lines.push(`JSON大小: ${logInfo.summary.jsonSize}`);
    lines.push('');

    lines.push('-'.repeat(60));
    lines.push('📁 各集合详情');
    lines.push('-'.repeat(60));
    lines.push('');

    for (const [name, stat] of Object.entries(logInfo.collectionStats)) {
      const statusIcon = stat.status === 'ok' ? '✅' : 
                         stat.status === 'empty' ? '⬜' :
                         stat.status === 'not_exist' ? '➖' : '❌';
      lines.push(`${statusIcon} ${name}: ${stat.count} 条${stat.error ? ` (${stat.error})` : ''}`);
    }
    lines.push('');

    if (logInfo.warnings.length > 0) {
      lines.push('-'.repeat(60));
      lines.push('⚠️ 提示信息');
      lines.push('-'.repeat(60));
      lines.push('');
      for (const w of logInfo.warnings) {
        lines.push(`- ${w}`);
      }
      lines.push('');
    }

    if (logInfo.imageErrors.length > 0) {
      lines.push('-'.repeat(60));
      lines.push('🔴 图片下载失败列表');
      lines.push('-'.repeat(60));
      lines.push('');
      for (let idx = 0; idx < logInfo.imageErrors.length; idx++) {
        const e = logInfo.imageErrors[idx];
        lines.push(`#${idx + 1} ${e.displayName || e.fileID || '未知'}`);
        lines.push(`   原因: ${e.reason || '未知'}`);
        if (e.fileID && e.fileID !== e.displayName) {
          lines.push(`   ID:   ${e.fileID}`);
        }
        lines.push('');
      }
      lines.push(`💡 常见原因:`);
      lines.push(`   ① 云存储文件已被删除 → 图片不存在了`);
      lines.push(`   ② 云存储权限变更 → 无法访问该文件`);
      lines.push(`   ③ 网络问题导致获取临时链接失败`);
      lines.push('');
      lines.push(`✅ 这些图片的 cloud:// 文件ID 已完整保存在 data.json 中，`);
      lines.push(`   导入到小程序后可以正常显示（只要云存储中的源文件还在）`);
      lines.push('');
    }

    if (logInfo.dataErrors.length > 0) {
      lines.push('-'.repeat(60));
      lines.push('🔴 数据查询错误');
      lines.push('-'.repeat(60));
      lines.push('');
      for (const e of logInfo.dataErrors) {
        lines.push(`- ${e.collection}: ${e.error}`);
      }
      lines.push('');
    }

    lines.push('=' . repeat(60));
    lines.push('📂 导出目录结构');
    lines.push('=' . repeat(60));
    lines.push('');
    lines.push(`${baseDir.split('/').pop()}/`);
    lines.push('├── 📄 data.json       (所有数据)');
    lines.push('├── 📄 export_log.txt (本日志文件)');
    lines.push('└── 📁 images/         (导出的图片)');
    
    if (logInfo.summary.successImages > 0) {
      lines.push(`    └── 共 ${logInfo.summary.successImages} 张图片`);
    }
    lines.push('');

    const logContent = lines.join('\n');
    fs.writeFileSync(`${baseDir}/export_log.txt`, logContent, 'utf8');
  },

  // 构建导出摘要文本（用于弹窗显示）
  _buildExportSummary(logInfo) {
    let content = `✅ 导出成功！\n\n📊 数据统计:\n`;
    
    content += `- 总记录数: ${logInfo.summary.totalRecords} 条\n`;
    content += `- 图片: ${logInfo.summary.successImages} 成功 / ${logInfo.summary.totalImages} 总计\n`;
    content += `- JSON: ${logInfo.summary.jsonSize}\n`;

    // 各集合详情（精简版）
    const nonEmpty = Object.entries(logInfo.collectionStats)
      .filter(([, s]) => s.count > 0);
    if (nonEmpty.length > 0) {
      content += `\n📋 数据详情:\n`;
      for (const [name, stat] of nonEmpty) {
        const cnNameMap = {
          diaries: '日记', comments: '评论', sticky_notes: '便利贴',
          anniversaries: '纪念日', quick_entries: '快捷入口', hobbies: '爱好标签',
          couple_things_progress: '情侣事项', photos: '照片', users: '用户'
        };
        content += `  · ${cnNameMap[name] || name}: ${stat.count}条\n`;
      }
    }

    if (logInfo.summary.failedImages > 0) {
      content += `\n⚠️ ${logInfo.summary.failedImages}张图片下载失败:\n`;
      for (let i = 0; i < Math.min(logInfo.imageErrors.length, 3); i++) {
        const e = logInfo.imageErrors[i];
        const name = e.displayName || e.fileID?.substring(0, 30) || '未知';
        const reason = e.reason?.substring(0, 30) || '';
        content += `  · ${name}\n    → ${reason}\n`;
      }
      if (logInfo.imageErrors.length > 3) {
        content += `  ... 还有${logInfo.imageErrors.length - 3}张，详见日志文件\n`;
      }
      content += `(数据已在JSON中保留)\n`;
    }

    if (logInfo.dataErrors.length > 0) {
      content += `\n⚠️ ${logInfo.dataErrors.length}个集合查询出错\n`;
    }

    content += '\n💡 日志文件中有完整错误详情';
    return content;
  },

  // 从数据记录中收集所有 cloud:// 文件ID
  _collectCloudFileIDs(records, idSet) {
    if (!records || !Array.isArray(records)) return;
    
    for (const record of records) {
      this._extractCloudFilesFromObject(record, idSet);
    }
  },

  // 递归提取对象中所有的 cloud:// 文件ID
  _extractCloudFilesFromObject(obj, idSet) {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      for (const item of obj) {
        this._extractCloudFilesFromObject(item, idSet);
      }
      return;
    }
    
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      
      // 检查是否是 cloud:// 文件ID
      if (typeof value === 'string' && value.startsWith('cloud://')) {
        idSet.add(value);
      } else if (typeof value === 'object' && value !== null) {
        this._extractCloudFilesFromObject(value, idSet);
      }
    }
  },

  // 批量下载并导出图片到指定文件夹
  async _exportImagesToFolder(fileIDs, imgDir, logInfo) {
    const results = [];
    
    // 先构建一个反向映射：fileID → 它属于哪些数据记录（用于显示友好名称）
    const idToContext = this._buildImageContextMap(fileIDs);
    
    // 分批下载（每次最多5个，避免并发过多）
    const batchSize = 5;
    
    for (let i = 0; i < fileIDs.length; i += batchSize) {
      const batch = fileIDs.slice(i, i + batchSize);
      wx.showLoading({ 
        title: `正在导出图片... (${Math.min(i + batchSize, fileIDs.length)}/${fileIDs.length})`, 
        mask: true 
      });

      const downloadPromises = batch.map(async (fileID, idx) => {
        const context = idToContext[fileID] || {};
        const displayName = context.hint || fileID.substring(0, 50);

        try {
          let tempUrl = null;

          // 方案1：客户端API
          try {
            const tempRes = await wx.cloud.getTempFileURL({
              fileList: [fileID]
            });
            tempUrl = tempRes.fileList[0].tempFileURL;
          } catch (clientErr) {
            console.warn(`客户端getTempFileURL失败, 尝试云函数:`, clientErr);
            
            // 方案2：云函数降级（管理员权限）
            try {
              const cloud = require('../../utils/cloud');
              const urls = await cloud.getTempFileURLs([fileID]);
              tempUrl = Array.isArray(urls) ? urls[0] : null;
            } catch (cloudFnErr) {
              console.error('云函数也失败了:', cloudFnErr);
              throw new Error(`获取临时链接失败(客户端+云函数均失败): ${cloudFnErr.message || cloudFnErr.errMsg}`);
            }
          }
          
          if (!tempUrl) throw new Error('获取临时链接返回为空');
          
          // 确定文件扩展名和文件名（使用更有意义的命名）
          const ext = this._guessImageExt(fileID) || '.jpg';
          const localName = `img_${String(i + idx).padStart(4, '0')}_${Date.now()}${ext}`;
          const localPath = `${imgDir}/${localName}`;
          
          // 直接用 downloadFile 保存到指定路径
          await new Promise((resolve, reject) => {
            wx.downloadFile({
              url: tempUrl,
              filePath: localPath,
              success: (saveRes) => {
                if (saveRes.statusCode === 200) resolve();
                else reject(new Error(`HTTP ${saveRes.statusCode}`));
              },
              fail: reject
            });
          });
          
          return {
            originalFileID: fileID,
            localPath,
            fileName: localName,
            relativePath: `images/${localName}`,
            displayName,
            status: 'ok'
          };
        } catch (err) {
          return {
            originalFileID: fileID,
            localPath: '',
            fileName: '',
            displayName,
            status: 'failed',
            error: err.message || String(err)
          };
        }
      });

      const batchResults = await Promise.all(downloadPromises);
      
      for (const result of batchResults) {
        if (result.status === 'ok') {
          results.push(result);
        } else {
          logInfo.imageErrors.push({
            fileID: result.originalFileID,
            displayName: result.displayName,
            reason: result.error || '未知错误'
          });
        }
      }
      
      if (i + batchSize < fileIDs.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`图片导出完成: 成功 ${results.length}, 失败 ${logInfo.imageErrors.length}`);
    return results;
  },

  // 构建图片ID到上下文的映射（用于在日志中友好地标识每张图片）
  _buildImageContextMap(fileIDs) {
    // 这里我们只能基于fileID本身推断一些信息
    // 实际场景中可以从已收集的collection数据中匹配
    const map = {};
    
    for (const fid of fileIDs) {
      const hint = this._extractHintFromFileID(fid);
      map[fid] = { hint };
    }
    
    return map;
  },

  // 从文件路径/ID中提取有意义的提示文字
  _extractHintFromFileID(fileID) {
    if (!fileID) return '';
    // cloud://xxx.envId/images/xxx_123456.jpg → 提取目录和文件名
    const match = fileID.match(/\/(\w+)\/[^/]+$/);
    if (match) {
      return `[${match[1]}] ${fileID.split('/').pop()}`;
    }
    return fileID;
  },

  // 根据文件ID猜测图片格式
  _guessImageExt(fileID) {
    const lower = (fileID || '').toLowerCase();
    if (lower.includes('.png')) return '.png';
    if (lower.includes('.gif')) return '.gif';
    if (lower.includes('.webp')) return '.webp';
    if (lower.includes('.bmp')) return '.bmp';
    return '.jpg'; // 默认jpeg
  },

  // 获取集合中所有数据（分页查询）- 增强版
  _fetchAllFromCollection(collectionName) {
    return new Promise((resolve, reject) => {
      // 先检查集合是否存在（通过一次简单查询）
      db.collection(collectionName)
        .limit(1)
        .get()
        .then(() => {
          // 集合存在，开始分页获取所有数据
          const allData = [];
          const pageSize = 20; // 客户端SDK单次查询硬上限20条（设100也只返回20）
          let page = 1;
          let queryCount = 0; // 查询次数限制，防止无限循环
          const maxQueries = 5000; // 最多查询5000页(约10万条)

          const fetchPage = () => {
            if (queryCount >= maxQueries) {
              console.warn(`⚠️ ${collectionName} 查询次数达到上限(5000次/约10万条)，已获取 ${allData.length} 条`);
              resolve(allData);
              return;
            }
            queryCount++;

            db.collection(collectionName)
              .skip((page - 1) * pageSize)
              .limit(pageSize)
              .get()
              .then(res => {
                const data = res.data || [];
                allData.push(...data);
                
                if (data.length < pageSize) {
                  // 已获取全部数据
                  resolve(allData);
                } else {
                  // 还有更多数据，继续查询下一页
                  page++;
                  fetchPage();
                }
              })
              .catch(err => {
                console.error(`查询 ${collectionName} 第${page}页失败:`, err);
                // 如果已经有一些数据，返回已有的；否则拒绝
                if (allData.length > 0) {
                  console.warn(`返回 ${collectionName} 的部分数据 (${allData.length} 条)`);
                  resolve(allData);
                } else {
                  reject(err);
                }
              });
          };

          fetchPage();
        })
        .catch(err => {
          // 集合不存在或查询失败
          if (err.errMsg && err.errMsg.includes('not found')) {
            console.log(`集合 ${collectionName} 不存在或为空`);
            resolve([]); // 返回空数组而非错误
          } else {
            reject(err);
          }
        });
    });
  },

  // 清除所有数据
  onClearData() {
    wx.showModal({
      title: '🗑️ 清除数据',
      content: '【极度危险】\n\n将删除以下所有集合的数据：\n· 日记、评论、便利贴\n· 纪念日、爱好、快捷入口\n· 情侣100件事、照片\n· 用户资料\n\n此操作不可撤销！\n\n确定要全部清除吗？',
      confirmText: '确认清除',
      confirmColor: '#e74c3c',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this._executeClear();
      },
      fail: (err) => {
        console.error('[clear] showModal 失败:', err);
        wx.showToast({ title: '弹窗失败', icon: 'none' });
      }
    });
  },

  // 执行清除
  async _executeClear() {
    console.log('[clear] 开始执行清除...');
    const { clearAllData } = cloud;

    // 先清除本地存储的userId和userProfile，防止mine页面自动重建用户
    userProfile.clearCache();
    wx.removeStorageSync('userId');
    // 同时清除示例日记等本地缓存
    wx.removeStorageSync('deletedDiaryDates');
    console.log('[clear] 已清除全部本地缓存');

    try {
      const result = await clearAllData();
      console.log('[clear] 完成:', result);
      const msg = `✅ 清除完成\n共删除 ${result.totalDeleted} 条记录${result.errors.length > 0 ? `\n⚠️ ${result.errors.length}条失败` : ''}\n\n即将返回首页`;
      wx.showModal({
        title: result.totalDeleted > 0 ? '🗑️ 已清除' : '⬜ 无数据',
        content: msg,
        showCancel: false,
        confirmText: '返回首页',
        success: () => {
          // 强制重载回首页，避免页面残留导致异常
          wx.reLaunch({ url: '/pages/index/index' });
        }
      });
    } catch(err) {
      console.error('[clear] 出错:', err);
      wx.showToast({ title: '清除失败:'+err.message, icon:'none', duration:3000 });
    }
  },

  // 导入数据
  onImportData() {
    console.log('[settings onImportData] === 开始执行导入警告弹窗 ===');
    wx.showToast({ title: '⚠️ 正在弹出确认窗口', icon: 'none', duration: 2000 });
    setTimeout(() => {
      console.log('[settings onImportData] 调用 showModal');
      wx.showModal({
        title: '⚠️ 危险操作警告',
        content: '【重要】\n\n导入数据将执行以下操作：\n1. 清空所有现有数据库数据\n2. 从JSON文件导入新数据\n3. 此操作不可撤销！\n\n是否继续？',
        confirmText: '确认导入',
        confirmColor: '#e74c3c',
        cancelText: '取消',
        success: (res) => {
          console.log('[settings onImportData] showModal 结果:', res.confirm ? 'confirm' : 'cancel');
          if (res.confirm) {
            this._doImportData();
          }
        },
        fail: (err) => {
          console.error('[settings onImportData] showModal 失败!', err);
          wx.showToast({ title: '弹窗失败:'+err.errMsg, icon:'none', duration:3000 });
        }
      });
    }, 500);
  },

  // 执行导入操作
  _doImportData() {
    // 使用微信选择文件API（如果支持）
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['.json'],
      success: (chooseRes) => {
        const tempFilePath = chooseRes.tempFiles[0].path;
        
        wx.showLoading({ title: '正在解析...', mask: true });
        
        // 读取JSON文件
        const fs = wx.getFileSystemManager();
        
        try {
          const fileContent = fs.readFileSync(tempFilePath, 'utf8');
          const importData = JSON.parse(fileContent);
          
          console.log('解析到的数据:', importData);
          
          // 验证数据格式
          if (!importData.collections || typeof importData.collections !== 'object') {
            throw new Error('无效的数据格式：缺少collections字段');
          }

          // 二次确认
          wx.hideLoading();
          
          const collectionCount = Object.keys(importData.collections).length;
          const recordCount = Object.values(importData.collections)
            .filter(Array.isArray)
            .reduce((sum, arr) => sum + arr.length, 0);

          wx.showModal({
            title: '最后确认',
            content: `即将导入数据：\n- 集合数: ${collectionCount}\n- 记录总数: ${recordCount}\n- 导出时间: ${importData.exportTime || '未知'}\n\n⚠️ 现有数据将被全部清除！\n\n确定执行导入吗？`,
            confirmText: '立即导入',
            confirmColor: '#e74c3c',
            cancelText: '取消',
            success: (confirmRes) => {
              if (confirmRes.confirm) {
                this._executeImport(importData);
              }
            }
          });

        } catch (err) {
          wx.hideLoading();
          console.error('解析文件失败:', err);
          let errorMsg = '文件解析失败';
          if (err.message.includes('JSON')) {
            errorMsg = '无效的JSON格式';
          } else if (err.message.includes('collections')) {
            errorMsg = err.message;
          }
          wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
        }
      },
      fail: (err) => {
        console.error('选择文件失败:', err);
        // 如果用户取消了选择，不显示错误
        if (err.errMsg && !err.errMsg.includes('cancel')) {
          wx.showToast({ title: '选择文件失败', icon: 'none' });
        }
      }
    });
  },

  // 执行实际的数据导入（修复版：保留_id保证引用一致性 + 回滚保护）
  async _executeImport(importData) {
    wx.showLoading({ title: '正在导入...', mask: true });

    // 清除本地缓存，防止mine页面用旧数据自动创建用户
    userProfile.clearCache();
    wx.removeStorageSync('userId');
    console.log('[import] 已清除本地 userId & userProfile');

    // === 第0步：清除所有旧数据（使用公共函数） ===
    const { clearAllData: doClear } = cloud;
    const clearResult = await doClear();
    console.log('[import] 清除旧数据完成:', clearResult);
    if (clearResult.errors.length > 0) {
      console.warn('[import] 清除时部分失败:', clearResult.errors);
    }

    // === 第1步：按依赖顺序插入新数据 ===
    const DEPENDENCY_ORDER = ['users','diaries','anniversaries','sticky_notes',
      'quick_entries','hobbies','couple_things_progress','comments','photos'];
    const collections = Object.keys(importData.collections);
    const sortedCols = DEPENDENCY_ORDER.filter(c=>collections.includes(c))
      .concat(collections.filter(c=>!DEPENDENCY_ORDER.includes(c)));

    let importedCount=0, errorCount=0, errors=[];
    const insertedIds={};

    try {
      for (const collectionName of sortedCols) {
        const records = importData.collections[collectionName];
        if (!Array.isArray(records)||records.length===0) continue;

        wx.showLoading({ title:`导入 ${collectionName}...`, mask:true });
        console.log(`[import] 开始: ${collectionName}, ${records.length}条`);

        insertedIds[collectionName]=[];

        try {
          // 插入新数据（保留原始_id，保证跨集合引用一致）
          for (const record of records) {
            try {
              // 保留原始_id，这样跨集合引用(diaryId等)不会断裂
              await db.collection(collectionName).add({ data: record });
              importedCount++;
              insertedIds[collectionName].push(record._id);
            } catch(addErr) {
              errorCount++;
              const msg=`${collectionName}/${record._id}: ${addErr.errMsg||addErr.message}`;
              errors.push(msg);
              console.warn(`[import] 插入失败:`, msg);
            }
          }
          console.log(`[import] 完成 ${collectionName}: 成功${insertedIds[collectionName].length}条`);

        } catch(colErr){
          errorCount+=records.length;
          errors.push(`集合${collectionName}异常: ${colErr.message}`);
          console.error(`[import] 集合异常 ${collectionName}:`, colErr);
        }
      }

      wx.hideLoading();

      // 显示结果
      const resultMsg = `导入完成！\n✅ 成功: ${importedCount} 条\n❌ 失败: ${errorCount} 条`;
      if (errors.length>0) {
        console.warn('[import] 错误详情:', errors);
        wx.showModal({
          title:'导入结果(有失败)',
          content:`${resultMsg}\n\n⚠️ 部分记录失败:\n${errors.slice(0,5).map(e=>'· '+e).join('\n')}${errors.length>5?`\n...等${errors.length}条`:''}\n\n即将返回首页`,
          showCancel:false,
          confirmText:'返回首页',
          success: () => { wx.reLaunch({ url: '/pages/index/index' }); }
        });
      } else {
        wx.showModal({
          title:'🎉 导入成功',
          content:`${resultMsg}\n\n即将返回首页`,
          showCancel:false,
          confirmText:'太好了',
          success: () => { wx.reLaunch({ url: '/pages/index/index' }); }
        });
      }

    } catch(err) {
      wx.hideLoading();
      console.error('[import] 致命错误:', err);
      // 尝试回滚已插入的新数据
      console.warn('[import] 尝试回滚已插入数据...');
      let rolledBack=0;
      for (const [col,ids] of Object.entries(insertedIds)) {
        for (const id of ids||[]) {
          try { await db.collection(col).doc(id).remove(); rolledBack++; } catch(_) {}
        }
      }
      wx.showModal({
        title:'❌ 导入失败',
        content:`错误: ${err.message}\n\n已回滚${rolledBack}条新数据。\n旧数据可能已被清除，请检查后重新导入。`,
        showCancel:false,
        confirmText:'知道了'
      });
    }
  },

  // 分享导出的文件给用户
  _shareExportedFile(filePath, fileName) {
    // 方式1：尝试用 shareFileMessage API（基础库 2.11.3+）
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath,
        fileName: fileName,
        success: () => {
          console.log('分享成功');
        },
        fail: (err) => {
          console.warn('shareFileMessage 失败，尝试保存到文档目录:', err);
          this._fallbackSaveFile(filePath, fileName);
        }
      });
    } else {
      // 旧版本：提示用户文件路径
      this._fallbackSaveFile(filePath, fileName);
    }
  },

  // 分享整个导出文件夹（新功能）
  _shareExportedFolder(baseDir, timestamp) {
    const fs = wx.getFileSystemManager();
    const folderName = baseDir.split('/').pop();
    
    // 尝试分享主JSON文件
    const jsonPath = `${baseDir}/data.json`;
    
    if (wx.shareFileMessage) {
      wx.shareFileMessage({
        filePath: jsonPath,
        fileName: `觅光手记备份_${timestamp}.json`,
        success: () => {
          console.log('数据文件分享成功');
          wx.showToast({ 
            title: '图片请在导出目录中查看', 
            icon: 'none', 
            duration: 3000 
          });
        },
        fail: (err) => {
          console.warn('分享失败，显示路径信息:', err);
          this._showFolderPathInfo(baseDir, folderName, fs);
        }
      });
    } else {
      this._showFolderPathInfo(baseDir, folderName, fs);
    }
  },

  // 显示导出目录的详细信息
  _showFolderPathInfo(baseDir, folderName, fs) {
    let jsonSize = '未知';
    let imgCount = 0;
    let imgSize = '未知';

    try { 
      const stat = fs.statSync(`${baseDir}/data.json`); 
      jsonSize = (stat.size / 1024).toFixed(1) + ' KB';
    } catch(e) {}
    
    try {
      const files = fs.readdirSync(`${baseDir}/images`) || [];
      imgCount = files.length;
      let totalSize = 0;
      for (const f of files) {
        try {
          const s = fs.statSync(`${baseDir}/images/${f}`);
          totalSize += s.size;
        } catch(e) {}
      }
      imgSize = (totalSize / 1024).toFixed(1) + ' KB';
    } catch(e) {}

    const content = `
📦 导出文件夹已创建！

📁 文件夹名: ${folderName}
├── 📄 data.json (${jsonSize})
├── 📄 export_log.txt (导出日志)
└── 📁 images/ (${imgCount}张图片, ${imgSize})

💡 真机上可通过"分享"按钮发送到电脑
📍 开发者工具中可在 Storage 面板查看`;

    wx.showModal({
      title: '导出完成',
      content: content.trim(),
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  // 兜底方案：打开文档让用户手动保存
  _fallbackSaveFile(filePath, fileName) {
    // 先获取文件大小
    let fileSize = '未知';
    try {
      const fs = wx.getFileSystemManager();
      const stat = fs.statSync(filePath);
      fileSize = (stat.size / 1024).toFixed(1);
    } catch(e) { /* ignore */ }

    const hint = '\n\n📱 模拟器中查看文件方法：\n1. 打开「微信开发者工具」\n2. 点击顶部菜单「调试器」→ 切换到「Storage」标签\n3. 文件在沙箱目录下：wxfile://usr/ 目录';
    
    wx.showModal({
      title: '导出完成',
      content: `文件已生成！\n📁 文件名：${fileName}\n💾 大小：${fileSize} KB\n${hint}`,
      showCancel: false,
      confirmText: '我知道了'
    });
  }
});
