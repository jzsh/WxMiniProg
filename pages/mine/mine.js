// pages/mine/mine.js
const cloud = require('../../utils/cloud');
const userProfile = require('../../utils/userProfile');
const db = wx.cloud.database();

Page({
  data: {
    userInfo: null,
    userId: '',
    displayName: '',  // 显示名称：有昵称显示昵称，否则显示ID后8位
    diaryCount: 0,
    photoCount: 0,
    version: '',
    menuList: [
      { icon: '❤️', title: '我的收藏', desc: '收藏的日记和内容', page: '/pages/favorites/favorites' },
      { icon: '📋', title: '历史记录', desc: '查看所有操作记录', page: '/pages/operation_history/operation_history' },
      { icon: '💾', title: '数据管理', desc: '导入/导出数据库数据', action: 'dataManagement' },
      { icon: '⚙️', title: '个人设置', desc: '修改昵称、头像等资料', page: '/pages/settings/settings' },
      { icon: '📝', title: '意见反馈', desc: '提交反馈和建议', page: '/pages/feedback/feedback' },
      { icon: 'ℹ️', title: '关于我们', desc: '版本信息与帮助', action: 'about' }
    ]
  },

  // 加载版本号（正式版从微信读取，开发环境降级使用下面手动维护的版本）
  _loadVersion() {
    const CURRENT_VERSION = '0.0.7';  // 每次上传新版本时同步修改这里
    try {
      const accountInfo = wx.getAccountInfoSync();
      const ver = accountInfo.miniProgram.version;
      // 正式版有版本号，开发版/体验版为空
      this.setData({ version: ver ? 'v' + ver : 'v' + CURRENT_VERSION + ' (开发版)' });
    } catch (e) {
      this.setData({ version: 'v' + CURRENT_VERSION });
    }
  },

  // 根据userInfo和userId计算显示名称
  _updateDisplayName() {
    const { userInfo, userId } = this.data;
    const name = (userInfo && userInfo.nickName) ? userInfo.nickName : (userId ? userId.slice(-8) : '');
    this.setData({ displayName: name });
  },

  onLoad() {
    this._initUserId();
    this._loadVersion();
  },

  // 初始化用户ID（只使用openid，不降级查找旧用户）
  _initUserId() {
    console.log('[Mine] ========== 开始初始化用户ID ==========');
    const cachedId = wx.getStorageSync('userId');
    console.log('[Mine] 本地缓存的 userId:', cachedId || '(空)');

    // 先用缓存显示，等确认后再更新
    if (cachedId) {
      this.setData({ userId: cachedId });
      this._afterInit(cachedId);
    }

    // 尝试获取真实的openid
    console.log('[Mine] 正在尝试获取 OpenID...');
    this._getOpenId().then(openid => {
      console.log('[Mine] _getOpenId 返回结果:', openid || 'null/undefined');

      if (openid) {
        console.log(`[Mine] ✅ 获取到openid: ${openid}`);

        if (cachedId !== openid) {
          console.log(`[Mine] ID变更(通过openid): ${cachedId} -> ${openid}`);
          wx.setStorageSync('userId', openid);
          this.setData({ userId: openid });
          userProfile.clearCache();
          this._afterInit(openid);
        } else {
          console.log('[Mine] openid 与缓存一致，无需更新');
        }

        // 确保用户文档存在（不存在则用openid创建空记录）
        this._ensureUserExists(openid);
      } else {
        // openid获取失败，不降级，只打日志等待下次重试
        console.warn('[Mine] ⚠️ openid获取失败，等待下次重试，不去数据库查找旧用户');
      }
    }).catch(err => {
      console.error('[Mine] _getOpenId异常:', err);
      console.warn('[Mine] 不执行降级查找，等待下次重试');
    });
  },

  // 确保用户文档存在（不存在则用openid创建空记录）
  _ensureUserExists(openid) {
    console.log('[Mine] [_ensureUserExists] 开始检查用户是否存在, openid:', openid);
    
    db.collection('users').doc(openid).get()
      .then(res => {
        console.log('[Mine] [_ensureUserExists] 查询结果:', res.data ? '存在' : '不存在');
        
        if (!res.data) {
          // 用户不存在，创建空记录（只有openid，其他字段为空）
          console.log('[Mine] [_ensureUserExists] 用户不存在，正在创建新用户...');
          
          return db.collection('users').add({
            data: {
              _id: openid,
              nickName: '',
              avatarUrl: '',
              gender: 2,
              phone: '',
              age: null,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          }).then(() => {
            console.log('[Mine] [_ensureUserExists] ✅ 自动创建用户成功:', openid);
          }).catch(err => {
            console.error('[Mine] [_ensureUserExists] ❌ 创建用户失败:', err);
          });
        } else {
          console.log('[Mine] [_ensureUserExists] 用户已存在，跳过创建');
        }
      })
      .catch(err => {
        console.warn('[Mine] [_ensureUserExists] 查询失败，尝试直接创建:', err);
        
        // 查询失败时也尝试创建（可能是不存在）
        return db.collection('users').add({
          data: {
            _id: openid,
            nickName: '',
            avatarUrl: '',
            gender: 2,
            phone: '',
            age: null,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        }).then(() => {
          console.log('[Mine] [_ensureUserExists] ✅ (降级)自动创建用户成功:', openid);
        }).catch(createErr => {
          console.error('[Mine] [_ensureUserExists] ❌ (降级)创建用户也失败:', createErr);
        });
      });
  },

  // 通过云函数获取openid
  _getOpenId() {
    return new Promise((resolve) => {
      // 方案1：尝试调用任意云函数获取openid
      // 云函数内部可以通过 cloud.getWXContext().OPENID 获取
      wx.cloud.callFunction({
        name: 'getTempURL',  // 复用已有云函数，只要能触发就行
        data: { _action: 'getOpenId' }  // 特殊参数让函数返回openid
      }).then(res => {
        // 如果云函数返回了openid就使用
        if (res.result && res.result.openid) {
          resolve(res.result.openid);
        } else {
          resolve(null);
        }
      }).catch(() => {
        resolve(null);
      });
      
      // 3秒超时保护，避免阻塞页面加载
      setTimeout(() => resolve(null), 3000);
    });
  },
  
  _afterInit(userId) {
    // 通过统一模块加载用户资料（缓存优先，无则自动从云端拉）
    userProfile.get().then(profile => {
      this.setData({ userInfo: profile });
      this._updateDisplayName();
      // 如果头像为云存储路径，转为临时链接
      if (profile.avatarUrl && profile.avatarUrl.startsWith('cloud://')) {
        this._loadAvatarTempURL(profile.avatarUrl);
      }
    });
    
    this._updateCounts();
  },

  onShow() {
    this._updateCounts();
    const userId = wx.getStorageSync('userId');
    if (userId) {
      // 每次显示都刷新用户资料（确保最新）
      userProfile.get({ forceRefresh: true }).then(profile => {
        this.setData({ userInfo: profile });
        this._updateDisplayName();
      });
    }
  },

  // 将云存储头像转为临时链接
  _loadAvatarTempURL(cloudPath) {
    cloud.getTempFileURLs([cloudPath]).then(urls => {
      if (urls && urls[0]) {
        this.setData({ 'userInfo.avatarUrl': urls[0] });
        // 同时更新本地缓存中的头像URL
        const profile = wx.getStorageSync('userProfile') || {};
        profile.avatarUrl = urls[0];
        wx.setStorageSync('userProfile', profile);
      }
    }).catch(err => {
      console.log('头像临时链接获取失败:', err);
    });
  },

  _updateCounts() {
    // 从云数据库获取真实统计
    db.collection('diaries').count().then(res => {
      this.setData({ diaryCount: res.total });
    }).catch(() => {
      this.setData({ diaryCount: (wx.getStorageSync('anniversaryList') || []).length });
    });
    db.collection('photos').count().then(res => {
      this.setData({ photoCount: res.total });
    }).catch(() => {
      this.setData({ photoCount: (wx.getStorageSync('albumPhotos') || []).length });
    });
  },

  goToSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  goToDiary() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goToPhoto() {
    wx.switchTab({ url: '/pages/album/album' });
  },

  goToAll() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  copyUserId() {
    wx.setClipboardData({
      data: this.data.userId,
      success: () => { wx.showToast({ title: '已复制', icon: 'success' }); }
    });
  },

  onMenuTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.menuList[index];
    
    // 处理特殊操作（如数据管理）
    if (item.action) {
      if (item.action === 'dataManagement') {
        this.showDataManagementMenu();
      } else if (item.action === 'about') {
        this.showAboutInfo();
      } else if (item.page) {
        wx.navigateTo({ url: item.page });
      }
      return;
    }
    
    if (item.page) {
      // tabBar页面不能navigateTo
      const tabBarPages = ['/pages/index/index', '/pages/album/album'];
      if (tabBarPages.includes(item.page)) {
        wx.switchTab({ url: item.page });
      } else {
        wx.navigateTo({ url: item.page, fail: () => { wx.showToast({ title: item.title + ' 开发中', icon: 'none' }); } });
      }
    } else {
      wx.showToast({ title: item.title + ' 开发中', icon: 'none' });
    }
  },

  // 显示关于我们信息
  showAboutInfo() {
    const ver = this.data.version || '开发版';
    wx.showModal({
      title: '关于我们',
      content: `觅光手记 ${ver}\n\n记录生活中的每一束光`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  // 显示数据管理菜单（导入/导出/清除）
  showDataManagementMenu() {
    wx.showActionSheet({
      itemList: ['📤 导出数据', '📥 导入数据', '🗑️ 清除数据'],
      success: (res) => {
        if (res.tapIndex === 0) {
          // 导出 - 本页原地执行，不跳转
          wx.showModal({
            title: '导出数据',
            content: '确定要导出所有数据吗？',
            confirmText: '开始导出',
            success: (modalRes) => {
              if (modalRes.confirm) this._exportData();
            }
          });
        } else if (res.tapIndex === 1) {
          // 导入 - 本页原地执行，不跳转
          this._importData();
        } else if (res.tapIndex === 2) {
          // 清除 - 本页原地执行，不跳转
          wx.showModal({
            title: '🗑️ 清除数据',
            content: '【极度危险】\n\n将删除以下所有集合的数据：\n· 日记、评论、便利贴\n· 纪念日、爱好、快捷入口\n· 情侣100件事、照片\n· 用户资料\n\n此操作不可撤销！\n\n确定要全部清除吗？',
            confirmText: '确认清除',
            confirmColor: '#e74c3c',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes.confirm) this._clearData();
            }
          });
        }
      },
      fail: () => {}
    });
  },

  // 在本页原地执行导出（调用公共导出函数）
  async _exportData() {
    const { doExport } = require('../../utils/cloud');
    await doExport();
  },

  // 在本页原地执行导入（不跳转）
  _importData() {
    wx.showModal({
      title: '⚠️ 危险操作警告',
      content: '【重要】\n\n导入数据将执行以下操作：\n1. 清空所有现有数据库数据\n2. 从JSON文件导入新数据\n3. 此操作不可撤销！\n\n是否继续？',
      confirmText: '确认导入',
      confirmColor: '#e74c3c',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this._doImportData();
      }
    });
  },

  async _doImportData() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['.json'],
      success: (chooseRes) => {
        const tempFilePath = chooseRes.tempFiles[0].path;
        wx.showLoading({ title: '正在解析...', mask: true });
        const fs = wx.getFileSystemManager();
        try {
          const fileContent = fs.readFileSync(tempFilePath, 'utf8');
          const importData = JSON.parse(fileContent);
          if (!importData.collections || typeof importData.collections !== 'object') {
            throw new Error('无效的数据格式：缺少collections字段');
          }
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
              if (confirmRes.confirm) this._executeImport(importData);
            }
          });
        } catch (err) {
          wx.hideLoading();
          let errorMsg = '文件解析失败';
          if (err.message.includes('JSON')) errorMsg = '无效的JSON格式';
          else if (err.message.includes('collections')) errorMsg = err.message;
          wx.showToast({ title: errorMsg, icon: 'none', duration: 3000 });
        }
      },
      fail: (err) => {
        if (err.errMsg && !err.errMsg.includes('cancel')) {
          wx.showToast({ title: '选择文件失败', icon: 'none' });
        }
      }
    });
  },

  async _executeImport(importData) {
    wx.showLoading({ title: '正在导入...', mask: true });
    const { doImport } = require('../../utils/cloud');
    try {
      const result = await doImport(importData);
      wx.hideLoading();
      const resultMsg = result.summary || '导入完成';
      const errors = result.errors || [];
      if (errors.length > 0) {
        wx.showModal({
          title: '导入结果(有失败)',
          content: `${resultMsg}\n\n⚠️ 部分记录失败:\n${errors.slice(0, 5).map(e => '· ' + e).join('\n')}${errors.length > 5 ? `\n...等${errors.length}条` : ''}`,
          showCancel: false,
          confirmText: '知道了'
        });
      } else {
        wx.showModal({
          title: '🎉 导入成功',
          content: `${resultMsg}`,
          showCancel: false,
          confirmText: '太好了'
        });
      }
      this._updateCounts();
      // 导入完成，清缓存跳首页（像重新进入小程序）
      userProfile.clearCache();
      wx.removeStorageSync('userId');
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '导入失败:' + err.message, icon: 'none', duration: 3000 });
    }
  },

  // 在本页原地执行清除
  async _clearData() {
    wx.showLoading({ title: '正在清除...', mask: true });
    const { clearAllData } = require('../../utils/cloud');
    try {
      const result = await clearAllData();
      wx.hideLoading();
      wx.showModal({
        title: result.totalDeleted > 0 ? '🗑️ 已清除' : '⬜ 无数据',
        content: `✅ 清除完成\n共删除 ${result.totalDeleted} 条记录${result.errors.length > 0 ? `\n⚠️ ${result.errors.length}条失败` : ''}`,
        showCancel: false,
        confirmText: '知道了'
      });
      this._updateCounts();
      // 清除完成，清缓存跳首页（像重新进入小程序）
      userProfile.clearCache();
      wx.removeStorageSync('userId');
      setTimeout(() => wx.switchTab({ url: '/pages/index/index' }), 500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '清除失败:' + err.message, icon: 'none', duration: 3000 });
    }
  },
})
