/**
 * userProfile.js — 统一用户资料管理模块
 *
 * 核心原则：
 *   读：缓存优先，缓存没有再去云端拉（所有页面共用同一套逻辑）
 *   写：同时更新缓存和云端（保证一致性）
 *
 * 使用方式：
 *   const userProfile = require('../../utils/userProfile');
 *   const profile = await userProfile.get();        // 读取（自动处理缓存/云端）
 *   await userProfile.save({ nickName: 'xxx' });    // 保存（同时写缓存+云端）
 *
 * 注意：cloud 模块在函数内部懒加载，避免在 wx.cloud.init() 之前被 require 导致报错。
 */

// 缓存 key（与 mine.js / settings.js 保持一致）
const CACHE_KEY = 'userProfile';
const USER_ID_KEY = 'userId';

/**
 * 获取用户资料（缓存优先，无则从云端拉取）
 *
 * @param {Object}  [options]
 * @param {boolean} options.forceRefresh  是否强制跳过缓存直接查云端
 * @returns {Promise<Object>}  { nickName, avatarUrl, gender, phone, age }
 */
function get(options) {
  options = options || {};
  return new Promise((resolve) => {
    // 1. 先读本地缓存
    if (!options.forceRefresh) {
      const cached = wx.getStorageSync(CACHE_KEY);
      if (cached && cached.nickName || cached.avatarUrl) {
        console.log('[userProfile.get] 命中缓存:', cached.nickName, cached.avatarUrl ? '(有头像)' : '');
        resolve(cached);
        return;
      }
    }

    // 2. 缓存为空或强制刷新，从云端拉
    const userId = wx.getStorageSync(USER_ID_KEY);
    if (!userId) {
      console.log('[userProfile.get] 无 userId，返回空资料');
      resolve({ nickName: '', avatarUrl: '' });
      return;
    }

    // 懒加载 cloud（此时 wx.cloud.init() 已执行完毕）
    const _cloud = require('./cloud');
    _cloud.getUserProfile(userId)
      .then(res => {
        if (res && res.data) {
          const p = res.data;
          const profile = {
            nickName: p.nickName || '',
            avatarUrl: p.avatarUrl || '',
            gender: p.gender !== undefined ? p.gender : 2,
            phone: p.phone || '',
            age: p.age !== undefined ? p.age : ''
          };
          // 写入缓存，下次不用再请求云端
          wx.setStorageSync(CACHE_KEY, profile);
          console.log('[userProfile.get] 从云端拉到并写入缓存:', profile.nickName, profile.avatarUrl ? '(有头像)' : '');
          resolve(profile);
        } else {
          console.warn('[userProfile.get] 云端返回空数据');
          resolve({ nickName: '', avatarUrl: '' });
        }
      })
      .catch(err => {
        console.error('[userProfile.get] 云端拉取失败:', err.errMsg || err.message);
        // 返回空对象而不是 reject，让调用方能继续运行
        resolve({ nickName: '', avatarUrl: '' });
      });
  });
}

/**
 * 保存用户资料（同时写入本地缓存 + 云端数据库）
 *
 * @param {Object} profile  { nickName, avatarUrl, gender, phone, age }
 * @returns {Promise<void>}
 */
function save(profile) {
  const userId = wx.getStorageSync(USER_ID_KEY);

  // 1. 立即更新本地缓存（同步操作，立刻生效）
  const toSave = {
    nickName: profile.nickName || '',
    avatarUrl: profile.avatarUrl || '',
    gender: profile.gender !== undefined ? profile.gender : 2,
    phone: profile.phone || '',
    age: profile.age !== undefined ? profile.age : null
  };
  wx.setStorageSync(CACHE_KEY, toSave);
  console.log('[userProfile.save] 本地缓存已更新:', toSave.nickName);

  // 2. 异步写入云端（不阻塞 UI）
  if (!userId) {
    console.warn('[userProfile.save] 无 userId，仅保存到本地');
    return Promise.resolve();
  }

  const _cloud = require('./cloud');
  return _cloud.updateUserProfile(userId, toSave).then(() => {
    console.log('[userProfile.save] 云端已同步');
  }).catch(err => {
    // 云端失败不影响本地使用，只打日志
    console.error('[userProfile.save] 云端同步失败:', err.errMsg);
  });
}

/**
 * 清除本地缓存的用户资料（导入数据 / 清除数据时调用）
 */
function clearCache() {
  wx.removeStorageSync(CACHE_KEY);
  console.log('[userProfile.clearCache] 已清除本地缓存');
}

module.exports = {
  get,
  save,
  clearCache,
  CACHE_KEY,
  USER_ID_KEY
};
