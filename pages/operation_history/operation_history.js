// pages/operation_history/operation_history.js
const cloud = require('../../utils/cloud');

Page({
  data: {
    operationLogs: [],
    loading: false,
    hasMore: true,
    page: 1,
    pageSize: 20,
    userId: '',
    collapsedMap: {} // 记录折叠状态，key为log._id, value为boolean
  },

  onLoad() {
    this.loadOperationLogs();
  },

  onShow() {
    // 刷新数据
    this.setData({ operationLogs: [], page: 1, hasMore: true, collapsedMap: {} });
    this.loadOperationLogs();
  },

  // ==================== 预处理：为每条日志计算所有显示文本 ====================
  // 微信小程序 WXML 调用函数不稳定，所以把格式化逻辑全部移到数据预处理阶段

  _preprocessLog(log) {
    if (!log) return log;

    const { operationType, entityType, entityContent, entityId } = log;

    // 0. 操作者显示名
    if (log._nickName) {
      log._displayUser = log._nickName;
    } else if (log.userId) {
      log._displayUser = log.userId.substring(0, 8) + '...';
    } else {
      log._displayUser = '未知用户';
    }

    // 1. 操作类型中文（带实体）
    const typeMap = { add: '添加', delete: '删除', update: '修改', unknown: '未知' };
    const entityMap = {
      diary: '日记', anniversary: '纪念日', comment: '评论', sticky_note: '便利贴',
      quick_entry: '快捷入口', hobby: '爱好标签', couple_thing: '情侣事项', user: '用户资料',
      comment_batch: '评论', couple_thing_batch: '情侣事项'
    };
    const typeText = typeMap[operationType] || operationType || '未知';
    const entityText = entityMap[entityType] || entityType || '记录';
    log._displayType = `${typeText}${entityText}`;

    // 2. 标签文字
    const labelMap = {
      diary: '标题', anniversary: '纪念日名称', comment: '评论内容',
      sticky_note: '便利贴内容', quick_entry: '快捷入口名称', hobby: '爱好标签名称',
      couple_thing: '事项内容', user: '用户资料'
    };
    log._displayLabel = labelMap[entityType] || entityType || '对象';

    // 3. 时间（短格式 + 完整格式）
    if (log.operationTime) {
      try {
        const date = new Date(log.operationTime);
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hour = date.getHours().toString().padStart(2, '0');
        const minute = date.getMinutes().toString().padStart(2, '0');
        const second = date.getSeconds().toString().padStart(2, '0');
        log._displayTimeFull = `${year}-${month}-${day} ${hour}:${minute}:${second}`;

        const now = new Date();
        const isThisYear = year === now.getFullYear();
        log._displayTime = isThisYear
          ? `${date.getMonth() + 1}.${day} ${hour}:${minute}`
          : `${year}.${month}.${day} ${hour}:${minute}`;
      } catch (e) {
        log._displayTime = log.operationTime;
        log._displayTimeFull = log.operationTime;
      }
    } else {
      log._displayTime = '';
      log._displayTimeFull = '';
    }

    // 4. 标题值
    if (!entityContent) {
      log._displayTitle = `ID: ${entityId || '未知'}`;
    } else if (typeof entityContent !== 'object') {
      log._displayTitle = String(entityContent);
    } else {
      switch (entityType) {
        case 'diary':
          log._displayTitle = operationType === 'delete'
            ? (entityContent.title || `原日记 (ID: ${entityId})`)
            : (entityContent.title || '（无标题）');
          break;
        case 'anniversary':
          log._displayTitle = entityContent.name || entityContent.date || `ID: ${entityId}`;
          break;
        case 'comment':
          log._displayTitle = entityContent.contentPreview || entityContent.content || '（无内容）';
          break;
        case 'sticky_note':
          log._displayTitle = entityContent.textPreview || '（空便利贴）';
          break;
        case 'quick_entry':
          log._displayTitle = entityContent.name || entityContent.page || '（未命名）';
          break;
        case 'hobby':
          log._displayTitle = entityContent.name || '（未命名）';
          break;
        case 'couple_thing':
          log._displayTitle = entityContent.thingText || `事项 #${entityContent.thingIndex || '?'}`;
          break;
        case 'user':
          if (entityContent.nickName) log._displayTitle = entityContent.nickName;
          else if (operationType === 'add') log._displayTitle = '创建用户资料';
          else log._displayTitle = '修改用户资料';
          break;
        default:
          const keys = Object.keys(entityContent).filter(k =>
            !k.startsWith('_') && entityContent[k] != null && entityContent[k] !== ''
          );
          if (keys.length > 0) {
            let val = String(entityContent[keys[0]]);
            log._displayTitle = val.length > 50 ? val.substring(0, 50) + '...' : val;
          } else {
            log._displayTitle = JSON.stringify(entityContent).substring(0, 50);
          }
      }
    }

    // 5. 详情文本
    if (!entityContent) {
      log._displayDetail = entityId ? `记录ID: ${entityId}` : '无详细内容';
    } else if (typeof entityContent !== 'object') {
      log._displayDetail = String(entityContent);
    } else {
      switch (entityType) {
        case 'diary': {
          let parts = [];
          // 动态从title截取60字符作为摘要，不再存冗余summary字段
          const rawSummary = entityContent.title || '';
          const shortSummary = rawSummary.length > 60 ? rawSummary.substring(0, 60) + '…' : rawSummary;
          if (shortSummary) parts.push(shortSummary);
          if (entityContent.date) parts.push(`日期：${entityContent.date}`);
          log._displayDetail = parts.join(' | ') || '无详细信息';
          break;
        }
        case 'anniversary': {
          let aParts = [];
          if (entityContent.date) aParts.push(`日期：${entityContent.date}`);
          if (entityContent.icon) aParts.push(`图标：${entityContent.icon}`);
          log._displayDetail = aParts.join(' | ') || (entityContent.name || '');
          break;
        }
        case 'comment':
          log._displayDetail = entityContent.nickname ? `昵称：${entityContent.nickname}` : (entityContent.contentPreview || '');
          break;
        case 'couple_thing': {
          let tParts = [];
          if (entityContent.action) tParts.push(`操作：${entityContent.action}`);
          if (entityContent.oldCompleted !== undefined && entityContent.newCompleted !== undefined) {
            tParts.push(`${entityContent.oldCompleted ? '已完成' : '未完成'} → ${entityContent.newCompleted ? '已完成' : '未完成'}`);
          }
          log._displayDetail = tParts.join(' | ') || (entityContent.thingText || '');
          break;
        }
        default:
          const dKeys = Object.keys(entityContent);
          log._displayDetail = dKeys.length > 0
            ? `${dKeys[0]}：${entityContent[dKeys[0]]}`
            : '无详细内容';
      }
    }

    // 6. detailsList 用于展开区域（保留原有逻辑）
    let hasDetails = false;
    let detailsList = [];
    if (entityContent && typeof entityContent === 'object') {
      const keys = Object.keys(entityContent);
      if (keys.length > 0) {
        hasDetails = true;
        detailsList = keys.map(key => ({ key, value: entityContent[key] }));
      }
    }
    log.hasDetails = hasDetails;
    log.detailsList = detailsList;

    return log;
  },

  // 加载操作日志
  loadOperationLogs() {
    if (this.data.loading || !this.data.hasMore) return;

    this.setData({ loading: true });

    let userId = wx.getStorageSync('userId');
    console.log('当前用户ID:', userId);

    if (!userId) {
      // userId为空时，先尝试从数据库查找已有用户并自动恢复
      console.warn('[History] userId为空，尝试从数据库查找已有用户...');
      wx.showLoading({ title: '正在恢复用户...', mask: true });
      
      const db = wx.cloud.database();
      
      // 先查users表
      db.collection('users').limit(10).get()
        .then(res => {
          const users = res.data || [];
          if (users.length > 0) {
            // 找到已有用户，自动使用第一个
            const foundUser = users[0];
            console.log('[History] 从数据库找到用户:', foundUser._id, foundUser.nickName);
            
            // 恢复userId到本地存储
            wx.setStorageSync('userId', foundUser._id);
            
            // 如果有用户资料也一起恢复
            if (foundUser.nickName || foundUser.avatarUrl) {
              const profile = {
                nickName: foundUser.nickName,
                avatarUrl: foundUser.avatarUrl,
                gender: foundUser.gender !== undefined ? foundUser.gender : 2
              };
              wx.setStorageSync('userProfile', profile);
              console.log('[History] 同时恢复了用户资料');
            }
            
            wx.hideLoading();
            wx.showToast({ 
              title: `已恢复用户: ${foundUser.nickName || foundUser._id.substring(0, 8)}`, 
              icon: 'success',
              duration: 2000
            });
            
            // 用恢复后的userId重新加载
            userId = foundUser._id;
            this.setData({ userId });
            this._doLoadLogs(userId);
          } else {
            // users表为空，试试从operation_logs找
            return db.collection('operation_logs')
              .orderBy('operationTime', 'desc')
              .limit(5)
              .get()
              .then(logRes => {
                const logs = logRes.data || [];
                if (logs.length > 0) {
                  const uniqueIds = [...new Set(logs.map(l => l.userId))];
                  console.log('[History] 从操作日志中发现userId:', uniqueIds);
                  
                  // 使用第一个ID
                  const recoveredId = uniqueIds[0];
                  wx.setStorageSync('userId', recoveredId);
                  
                  wx.hideLoading();
                  wx.showToast({ title: `已恢复用户(${recoveredId.substring(0, 8)}...)`, icon: 'success', duration: 2000 });
                  
                  userId = recoveredId;
                  this.setData({ userId });
                  this._doLoadLogs(userId);
                } else {
                  wx.hideLoading();
                  wx.showToast({ title: '暂无数据，请先创建内容', icon: 'none' });
                  this.setData({ loading: false });
                }
              });
          }
        })
        .catch(err => {
          console.error('[History] 查找用户失败:', err);
          wx.hideLoading();
          wx.showToast({ title: '用户未登录', icon: 'none' });
          this.setData({ loading: false });
        });
      return;
    }

    this._doLoadLogs(userId);
  },

  // 实际执行日志查询（查询所有用户的日志，不仅限于当前用户）
  _doLoadLogs() {

    console.log('查询操作日志（所有用户），参数:', { pageSize: this.data.pageSize, page: this.data.page });
    
    // 查询所有用户的操作日志
    cloud.getAllOperationLogs(this.data.pageSize, this.data.page).then(async res => {
      console.log('操作日志查询结果:', res);
      const logs = res.data || [];
      console.log('日志数量:', logs.length);
      
      // 收集所有不重复的 userId，批量查询昵称
      const uniqueUserIds = [...new Set(logs.map(l => l.userId).filter(Boolean))];
      const nickNameMap = {};
      if (uniqueUserIds.length > 0) {
        try {
          const db = wx.cloud.database();
          // 分批查询（每批最多20个ID，客户端SDK限制）
          for (let i = 0; i < uniqueUserIds.length; i += 20) {
            const batch = uniqueUserIds.slice(i, i + 20);
            const userRes = await db.collection('users').where({
              _id: db.command.in(batch)
            }).limit(20).get().catch(() => ({ data: [] }));
            (userRes.data || []).forEach(u => {
              nickNameMap[u._id] = u.nickName || '';
            });
          }
        } catch (e) {
          console.warn('[History] 查询用户昵称失败:', e);
        }
      }

      // 预处理数据，注入昵称
      const processedLogs = logs.map(log => {
        log._nickName = nickNameMap[log.userId] || '';
        return this._preprocessLog(log);
      });
      
      const operationLogs = this.data.operationLogs.concat(processedLogs);
      console.log('合并后的操作日志总数:', operationLogs.length);
      
      this.setData({
        operationLogs,
        loading: false,
        hasMore: processedLogs.length >= this.data.pageSize,
        page: this.data.page + 1
      });
    }).catch(err => {
      console.error('加载操作日志失败:', err);
      wx.showToast({ title: `加载失败`, icon: 'none' });
      this.setData({ loading: false });
    });
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({ operationLogs: [], page: 1, hasMore: true });
    this.loadOperationLogs();
    wx.stopPullDownRefresh();
  },

  // 上拉加载更多
  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadOperationLogs();
    }
  },

  // 格式化操作类型
  formatOperationType(type) {
    const typeMap = {
      'add': '添加',
      'delete': '删除',
      'update': '更新',
      'unknown': '未知'
    };
    return typeMap[type] || type;
  },

  // 格式化实体类型
  formatEntityType(type) {
    const typeMap = {
      'diary': '日记',
      'anniversary': '纪念日',
      'comment': '评论',
      'comment_batch': '评论(批量)',
      'sticky_note': '便利贴',
      'quick_entry': '快捷入口',
      'hobby': '爱好标签',
      'couple_thing': '情侣事项',
      'couple_thing_batch': '情侣事项(批量)',
      'user': '用户资料',
      'unknown': '未知'
    };
    return typeMap[type] || type;
  },

  // 格式化时间（完整版）
  formatTime(time) {
    if (!time) return '';
    const date = new Date(time);
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  },

  // 格式化时间（短格式，用于显示）
  formatTimeShort(time) {
    if (!time) return '';
    const date = new Date(time);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    
    // 判断是否是今年
    const now = new Date();
    const isThisYear = year === now.getFullYear();
    
    if (isThisYear) {
      return `${month}.${day} ${hour}:${minute}`;
    }
    return `${year}.${month}.${day} ${hour}:${minute}`;
  },

  // 获取用户显示名称（从本地存储）
  getUserDisplayName() {
    try {
      const userProfile = wx.getStorageSync('userProfile');
      if (userProfile && userProfile.nickName) {
        return userProfile.nickName;
      }
      // 兼容旧存储方式
      const nickName = wx.getStorageSync('nickName');
      return nickName || '您';
    } catch (err) {
      return '您';
    }
  },

  // 获取操作描述（改进版，更可读）
  getOperationDescription(log) {
    const { operationType, entityType, entityContent, entityId } = log;
    const typeChinese = this.formatOperationType(operationType);
    const entityChinese = this.formatEntityType(entityType);
    const userDisplay = this.getUserDisplayName();
    
    let actionDetail = '';
    let contentDetail = '';
    
    // 根据实体类型和操作类型生成详细描述
    if (entityType === 'diary') {
      if (operationType === 'add') {
        actionDetail = '添加了一篇日记';
        contentDetail = entityContent.title ? `《${entityContent.title}》` : '（无标题）';
        if (entityContent.date) {
          contentDetail += `，日期：${entityContent.date}`;
        }
      } else if (operationType === 'update') {
        actionDetail = '更新了日记';
        contentDetail = entityContent.title ? `《${entityContent.title}》` : `（ID: ${entityId}）`;
        if (entityContent.date) {
          contentDetail += `，日期：${entityContent.date}`;
        }
      } else if (operationType === 'delete') {
        actionDetail = '删除了日记';
        contentDetail = entityContent.title ? `《${entityContent.title}》` : `（ID: ${entityId}）`;
        if (entityContent.date) {
          contentDetail += `，原日期：${entityContent.date}`;
        }
      }
    } else if (entityType === 'anniversary') {
      if (operationType === 'add') {
        actionDetail = '添加了一个纪念日';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : '（未命名）';
        if (entityContent.date) {
          contentDetail += `，日期：${entityContent.date}`;
        }
        if (entityContent.icon) {
          contentDetail += `，图标：${entityContent.icon}`;
        }
      } else if (operationType === 'update') {
        actionDetail = '更新了纪念日';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : `（ID: ${entityId}）`;
      } else if (operationType === 'delete') {
        actionDetail = '删除了纪念日';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : `（ID: ${entityId}）`;
        if (entityContent.date) {
          contentDetail += `，原日期：${entityContent.date}`;
        }
      }
    } else if (entityType === 'comment') {
      if (operationType === 'add') {
        actionDetail = '添加了一条评论';
        contentDetail = entityContent.contentPreview ? `"${entityContent.contentPreview}"` : '（无内容）';
        if (entityContent.nickname) {
          contentDetail += `，昵称：${entityContent.nickname}`;
        }
      } else if (operationType === 'delete') {
        actionDetail = '删除了评论';
        contentDetail = entityContent.contentPreview ? `"${entityContent.contentPreview}"` : `（ID: ${entityId}）`;
      }
    } else if (entityType === 'sticky_note') {
      if (operationType === 'add') {
        actionDetail = '添加了一张便利贴';
        contentDetail = entityContent.textPreview ? `"${entityContent.textPreview}"` : '（无内容）';
      } else if (operationType === 'delete') {
        actionDetail = '删除了便利贴';
        contentDetail = entityContent.textPreview ? `"${entityContent.textPreview}"` : `（ID: ${entityId}）`;
      }
    } else if (entityType === 'quick_entry') {
      if (operationType === 'add') {
        actionDetail = '添加了一个快捷入口';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : '（未命名）';
        if (entityContent.page) {
          contentDetail += `，页面：${entityContent.page}`;
        }
      } else if (operationType === 'delete') {
        actionDetail = '删除了快捷入口';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : `（ID: ${entityId}）`;
      }
    } else if (entityType === 'hobby') {
      if (operationType === 'add') {
        actionDetail = '添加了一个爱好标签';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : '（未命名）';
      } else if (operationType === 'delete') {
        actionDetail = '删除了爱好标签';
        contentDetail = entityContent.name ? `"${entityContent.name}"` : `（ID: ${entityId}）`;
      }
    } else if (entityType === 'couple_thing') {
      if (operationType === 'add') {
        actionDetail = '添加了情侣事项';
        contentDetail = entityContent.thingText ? `"${entityContent.thingText}"` : `事项 #${entityContent.thingIndex}`;
        if (entityContent.action) {
          contentDetail += `，操作：${entityContent.action}`;
        }
      } else if (operationType === 'update') {
        actionDetail = '更新了情侣事项';
        contentDetail = entityContent.thingText ? `"${entityContent.thingText}"` : `事项 #${entityContent.thingIndex}`;
        if (entityContent.action) {
          contentDetail += `，操作：${entityContent.action}`;
        }
        if (entityContent.oldCompleted !== undefined && entityContent.newCompleted !== undefined) {
          contentDetail += `，状态：${entityContent.oldCompleted ? '已完成' : '未完成'} → ${entityContent.newCompleted ? '已完成' : '未完成'}`;
        }
      } else if (operationType === 'delete') {
        actionDetail = '删除了情侣事项';
        contentDetail = entityContent.thingText ? `"${entityContent.thingText}"` : `事项 #${entityContent.thingIndex}`;
      }
    } else if (entityType === 'user') {
      if (operationType === 'add') {
        actionDetail = '创建了用户资料';
        contentDetail = entityContent.nickName ? `昵称：${entityContent.nickName}` : '';
      } else if (operationType === 'update') {
        actionDetail = '更新了用户资料';
        if (entityContent.nickName) {
          contentDetail = `昵称：${entityContent.nickName}`;
        }
        if (entityContent.hasAvatar) {
          contentDetail += (contentDetail ? '，' : '') + '更新了头像';
        }
        if (entityContent.hasAge) {
          contentDetail += (contentDetail ? '，' : '') + '更新了年龄';
        }
      }
    } else if (entityType === 'comment_batch') {
      // 批量删除评论
      if (operationType === 'delete') {
        actionDetail = '批量删除了评论';
        contentDetail = entityContent.count ? `${entityContent.count}条评论` : '多条评论';
        if (entityContent.diaryId) {
          contentDetail += `，所属日记ID：${entityContent.diaryId}`;
        }
      }
    } else if (entityType === 'couple_thing_batch') {
      // 批量删除情侣事项
      if (operationType === 'delete') {
        actionDetail = '批量删除了情侣事项';
        contentDetail = entityContent.count ? `${entityContent.count}条事项` : '多条事项';
      }
    } else if (entityType.includes('_batch')) {
      // 其他批量操作
      if (operationType === 'delete') {
        actionDetail = '批量删除了';
        contentDetail = entityContent.count ? `${entityContent.count}条${entityChinese}` : `多条${entityChinese}`;
      }
    } else {
      // 未知类型
      actionDetail = `${typeChinese}了${entityChinese}`;
      if (entityContent && Object.keys(entityContent).length > 0) {
        contentDetail = JSON.stringify(entityContent);
      }
    }
    
    // 如果没有生成具体的 actionDetail，使用默认格式
    if (!actionDetail) {
      actionDetail = `${typeChinese}了${entityChinese}`;
    }
    
    // 组合最终描述
    let description = `${userDisplay} ${actionDetail}`;
    if (contentDetail) {
      description += `：${contentDetail}`;
    }
    
    return description;
  },

  // 获取操作图标
  getOperationIcon(log) {
    const { operationType } = log;
    const iconMap = {
      'add': '➕',
      'delete': '❌',
      'update': '✏️',
      'unknown': '❓'
    };
    return iconMap[operationType] || '📝';
  },

  // ==================== 新增：中文竖版格式化函数 ====================

  // 获取操作类型的中文名称（带实体类型）- 增加容错
  getOperationTypeChinese(log) {
    if (!log) return '未知操作';
    const { operationType, entityType } = log;
    const typeMap = { add: '添加', delete: '删除', update: '修改', unknown: '未知' };
    const entityMap = { 
      diary: '日记', anniversary: '纪念日', comment: '评论', sticky_note: '便利贴',
      quick_entry: '快捷入口', hobby: '爱好标签', couple_thing: '情侣事项', user: '用户资料',
      comment_batch: '评论', couple_thing_batch: '情侣事项'
    };
    
    const typeText = typeMap[operationType] || operationType || '未知';
    const entityText = entityMap[entityType] || entityType || '记录';
    
    return `${typeText}${entityText}`;
  },

  // 获取标题行的标签文字
  getLabelTitle(log) {
    if (!log) return '对象';
    const typeMap = {
      diary: '标题',
      anniversary: '纪念日名称',
      comment: '评论内容',
      sticky_note: '便利贴内容',
      quick_entry: '快捷入口名称',
      hobby: '爱好标签名称',
      couple_thing: '事项内容',
      user: '用户资料'
    };
    return typeMap[log.entityType] || log.entityType || '对象';
  },

  // 获取标题行的值
  getTitleValue(log) {
    if (!log) return '（数据异常）';
    const { operationType, entityType, entityContent } = log;
    
    if (!entityContent) return `ID: ${log.entityId || '未知'}`;
    
    // 确保entityContent是对象
    if (typeof entityContent !== 'object') return String(entityContent);
    
    switch (entityType) {
      case 'diary':
        if (operationType === 'delete') return entityContent.title || `原日记 (ID: ${log.entityId})`;
        return entityContent.title || '（无标题）';
        
      case 'anniversary':
        return entityContent.name || entityContent.date || `ID: ${log.entityId}`;
        
      case 'comment':
        return entityContent.contentPreview || entityContent.content || '（无内容）';
        
      case 'sticky_note':
        return entityContent.textPreview || '（空便利贴）';
        
      case 'quick_entry':
        return entityContent.name || entityContent.page || '（未命名）';
        
      case 'hobby':
        return entityContent.name || '（未命名）';
        
      case 'couple_thing':
        return entityContent.thingText || `事项 #${entityContent.thingIndex || '?'}`;
        
      case 'user':
        if (entityContent.nickName) return entityContent.nickName;
        if (operationType === 'add') return '创建用户资料';
        return '修改用户资料';
        
      default:
        // 尝试获取第一个有意义的字段
        const keys = Object.keys(entityContent).filter(k => 
          !k.startsWith('_') && entityContent[k] !== null && entityContent[k] !== undefined && entityContent[k] !== ''
        );
        if (keys.length > 0) {
          const val = String(entityContent[keys[0]]);
          return val.length > 50 ? val.substring(0, 50) + '...' : val;
        }
        return JSON.stringify(entityContent).substring(0, 50);
    }
  },

  // 获取详情文本（简短版，显示在"详情："后）- 增强容错
  getDetailText(log) {
    if (!log) return '无详细内容';
    const { operationType, entityType, entityContent } = log;
    
    if (!entityContent) {
      // 尝试使用原始数据
      if (log.entityId) return `记录ID: ${log.entityId}`;
      return '无详细内容';
    }
    
    // 确保entityContent是对象
    if (typeof entityContent !== 'object') return String(entityContent);
    
    switch (entityType) {
      case 'diary':
        let detailParts = [];
        const rawTitle = entityContent.title || '';
        const shortTitle = rawTitle.length > 60 ? rawTitle.substring(0, 60) + '…' : rawTitle;
        if (shortTitle) detailParts.push(shortTitle);
        if (entityContent.date) detailParts.push(`日期：${entityContent.date}`);
        return detailParts.join(' | ') || '无详细信息';
        
      case 'anniversary':
        let annParts = [];
        if (entityContent.date) annParts.push(`日期：${entityContent.date}`);
        if (entityContent.icon) annParts.push(`图标：${entityContent.icon}`);
        return annParts.join(' | ') || entityContent.name || '';
        
      case 'comment':
        if (entityContent.nickname) return `昵称：${entityContent.nickname}`;
        return entityContent.contentPreview || '';
        
      case 'couple_thing':
        let thingParts = [];
        if (entityContent.action) thingParts.push(`操作：${entityContent.action}`);
        if (entityContent.oldCompleted !== undefined && entityContent.newCompleted !== undefined) {
          thingParts.push(`${entityContent.oldCompleted ? '已完成' : '未完成'} → ${entityContent.newCompleted ? '已完成' : '未完成'}`);
        }
        return thingParts.join(' | ') || entityContent.thingText || '';
        
      default:
        // 返回第一个字段作为预览
        const keys = Object.keys(entityContent);
        if (keys.length > 0) {
          return `${keys[0]}：${entityContent[keys[0]]}`;
        }
        return '无详细内容';
    }
  },

  // 判断是否有更多详情可以展开
  hasMoreDetails(log) {
    if (!log.hasDetails) return false;
    if (!log.detailsList || log.detailsList.length <= 1) return false; // 只有1个或更少时不显示展开按钮
    return true;
  },

  // 切换折叠状态
  toggleCollapse(e) {
    const id = e.currentTarget.dataset.id;
    const collapsedMap = this.data.collapsedMap;
    collapsedMap[id] = !collapsedMap[id];
    this.setData({ collapsedMap });
  }
});