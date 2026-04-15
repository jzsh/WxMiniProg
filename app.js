// app.js
// 注意：不能在这里初始化 db，必须在 wx.cloud.init() 之后！

const userProfile = require('./utils/userProfile');

App({
  onLaunch() {
    console.log('[App] ========== 小程序启动 ==========');

    // 检查页面栈，如果非空则重置（避免 appLaunch with non-empty page stack 错误）
    const pages = getCurrentPages();
    if (pages && pages.length > 0) {
      console.warn('检测到非空页面栈，重置到首页');
      wx.reLaunch({
        url: '/pages/index/index'
      });
    }

    // 初始化云开发
    if (wx.cloud) {
      wx.cloud.init({
        env: 'your-cloud-env-id',  // TODO: 替换为你的云环境ID
        traceUser: true
      });

      // ✅ 启动时自动初始化用户（获取OpenID并确保用户文档存在）
      this._initUserOnLaunch();

      // 启动时清理孤儿评论（必须在 init 之后）
      const cloud = require('./utils/cloud');
      cloud.cleanOrphanComments();
    }
  },

  // 在小程序启动时就初始化用户ID（不依赖 mine 页面）
  _initUserOnLaunch() {
    const cachedId = wx.getStorageSync('userId');
    console.log('[App] 本地缓存的 userId:', cachedId || '(空)');

    // 尝试获取真实的openid
    console.log('[App] 正在尝试获取 OpenID...');
    this._getOpenId().then(openid => {
      console.log('[App] _getOpenId 返回结果:', openid || 'null/undefined');

      if (openid) {
        console.log(`[App] ✅ 获取到openid: ${openid}`);

        if (cachedId !== openid) {
          // openid与缓存不同，以openid为准
          console.log(`[App] ID变更: ${cachedId} -> ${openid}`);
          wx.setStorageSync('userId', openid);
          // 清除旧的用户资料缓存，因为换用户了
          if (cachedId && cachedId !== openid) {
            userProfile.clearCache();
            console.log('[App] 已清除旧的用户资料缓存');
          }
        } else {
          console.log('[App] openid 与缓存一致，无需更新');
        }

        // 确保用户文档存在（不存在则用openid创建空记录）
        console.log('[App] 调用 _ensureUserExists...');
        this._ensureUserExists(openid);
      } else {
        console.warn('[App] ❌ OpenID 获取失败，使用缓存或降级处理');
        // 如果有缓存就用缓存，没有的话等mine页面处理
        if (!cachedId) {
          console.warn('[App] 无缓存且无OpenID，等待用户进入"我的"页面时处理');
        }
      }
    }).catch(err => {
      console.error('[App] _getOpenId 异常:', err);
    });
  },

  // 通过云函数获取openid（兼容多种方式）
  _getOpenId() {
    return new Promise((resolve) => {
      console.log('[App] [_getOpenId] 开始尝试获取 OpenID...');

      // 方法1：尝试调用专用的 getOpenId 云函数（如果有）
      wx.cloud.callFunction({
        name: 'getOpenId'
      }).then(res => {
        console.log('[App] [_getOpenId] getOpenId 云函数成功:', JSON.stringify(res));
        
        if (res.result && res.result.openid) {
          console.log('[App] [_getOpenId] ✅ 成功获取到openid:', res.result.openid);
          return resolve(res.result.openid);
        }
        throw new Error('no openid in result');
      }).catch(err1 => {
        console.warn('[App] [_getOpenId] getOpenId 失败或不存在, 尝试 getTempURL:', err1.errMsg || err1);
        
        // 方法2：降级到 getTempURL（带 _action 参数）
        return wx.cloud.callFunction({
          name: 'getTempURL',
          data: { 
            fileList: ['dummy'],  // 必须传一个假参数避免走错分支
            _action: 'getOpenId' 
          }
        }).then(res => {
          console.log('[App] [_getOpenId] getTempURL 返回:', JSON.stringify(res));
          
          if (res.result && res.result.openid) {
            console.log('[App] [_getOpenId] ✅ 通过 getTempURL 获取到openid:', res.result.openid);
            return resolve(res.result.openid);
          }
          
          // 如果还是没有，检查是否有其他字段
          if (res.result && res.result.code === 0) {
            console.warn('[App] [_getOpenId] ⚠️ getTempURL 返回了但没有openid');
            resolve(null);
          } else {
            throw new Error('getTempURL also failed');
          }
        }).catch(err2 => {
          console.error('[App] [_getOpenId] 所有方法都失败');
          console.error('[App] [_getOpenId]   getOpenId error:', err1.errMsg || err1);
          console.error('[App] [_getOpenId]   getTempURL error:', err2.errMsg || err2);
          resolve(null);
        });
      });

      // 8秒超时保护（给足够时间尝试两种方法）
      setTimeout(() => {
        console.warn('[App] [_getOpenId] ⏰ 超时(8秒)，返回null');
        resolve(null);
      }, 8000);
    });
  },

  // 确保用户文档存在（不存在则用openid创建空记录）
  _ensureUserExists(openid) {
    console.log('[App] [_ensureUserExists] 开始检查用户是否存在, openid:', openid);

    // 在这里初始化数据库（确保在 wx.cloud.init() 之后）
    const db = wx.cloud.database();

    db.collection('users').doc(openid).get()
      .then(res => {
        console.log('[App] [_ensureUserExists] 查询结果:', res.data ? '存在' : '不存在');

        if (!res.data) {
          // 用户不存在，创建空记录（只有openid，其他字段为空）
          console.log('[App] [_ensureUserExists] 用户不存在，正在创建新用户...');

          return db.collection('users').add({
            data: {
              _id: openid,
              openid: openid,
              nickName: '',
              avatarUrl: '',
              gender: 2,
              phone: '',
              age: null,
              createdAt: db.serverDate(),
              updatedAt: db.serverDate()
            }
          }).then(() => {
            console.log('[App] [_ensureUserExists] ✅ 自动创建用户成功:', openid);
          }).catch(err => {
            console.error('[App] [_ensureUserExists] ❌ 创建用户失败:', err);
          });
        } else {
          console.log('[App] [_ensureUserExists] 用户已存在，跳过创建');
        }
      })
      .catch(err => {
        console.warn('[App] [_ensureUserExists] 查询失败，尝试直接创建:', err);

        // 查询失败时也尝试创建（可能是不存在）
        return db.collection('users').add({
          data: {
            _id: openid,
            openid: openid,
            nickName: '',
            avatarUrl: '',
            gender: 2,
            phone: '',
            age: null,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        }).then(() => {
          console.log('[App] [_ensureUserExists] ✅ (降级)自动创建用户成功:', openid);
        }).catch(createErr => {
          // 如果是重复键错误，说明用户已存在，不是真正的错误
          const errMsg = createErr.errMsg || '';
          if (errMsg.includes('E11000') || errMsg.includes('duplicate')) {
            console.log('[App] [_ensureUserExists] 用户已存在（重复键），无需创建');
          } else {
            console.error('[App] [_ensureUserExists] ❌ (降级)创建用户也失败:', createErr);
          }
        });
      });
  },

  onShow() {
    console.log("App Show")
  },

  globalData: {
    userInfo: null
  }
})
