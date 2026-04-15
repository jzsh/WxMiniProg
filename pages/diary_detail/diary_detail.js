// pages/diary_detail/diary_detail.js
const cloud = require('../../utils/cloud');
const userProfile = require('../../utils/userProfile');
const db = wx.cloud.database();

Page({
  data: {
    diary: null,
    comments: [],
    commentText: '',
    liked: false,
    likeCount: 0,
    showCommentInput: false,
    isFav: false,
    favId: ''
  },

  onLoad(options) {
    // 支持通过 id 参数直接跳转（如从收藏页跳转）
    if (options.id) {
      this._diaryId = options.id;
      this._loadDiaryById(options.id);
    }

    const eventChannel = this.getOpenerEventChannel();
    eventChannel.on('diaryData', (data) => {
      this._applyDiaryData(data);
      wx.setNavigationBarTitle({ title: data.title || '日记详情' });
      const commentId = data._id || ('demo_' + data.date + '_' + data.title);
      this._loadComments(commentId);
      if (data._id) {
        this._diaryId = data._id;
        this._checkFavorite(data._id);
      }
    });
  },

  _loadDiaryById(id) {
    wx.showLoading({ title: '加载中...', mask: true });
    cloud.getDiary(id).then(res => {
      wx.hideLoading();
      const data = res.data;
      // 转换云存储图片链接
      const allImageIds = [];
      if (data.coverImage && data.coverImage.startsWith('cloud://')) allImageIds.push(data.coverImage);
      (data.images || []).forEach(img => { if (img && img.startsWith('cloud://')) allImageIds.push(img); });

      const applyData = (d) => {
        this._applyDiaryData(d);
        wx.setNavigationBarTitle({ title: d.title || '日记详情' });
        const commentId = d._id || ('demo_' + d.date + '_' + d.title);
        this._loadComments(commentId);
        this._checkFavorite(d._id);
      };

      if (allImageIds.length > 0) {
        cloud.getTempFileURLs(allImageIds).then(tempURLs => {
          let idx = 0;
          if (data.coverImage && data.coverImage.startsWith('cloud://')) data.coverImage = tempURLs[idx++];
          data.images = (data.images || []).map(img => (img && img.startsWith('cloud://')) ? tempURLs[idx++] : img);
          applyData(data);
        });
      } else {
        applyData(data);
      }
    }).catch(err => {
      wx.hideLoading();
      console.error('加载日记失败:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  _applyDiaryData(data) {
    this.setData({ diary: data, likeCount: data.likeCount || 0 });
  },

  /**
   * 加载评论并通过 openid 从 users 表批量查询昵称/头像
   * comments 表存 content + userId(openid)，通过 openid 字段查 users 表
   */
  async _loadComments(diaryId) {
    console.log('[DiaryDetail] _loadComments 开始, diaryId:', diaryId);

    let res;
    try {
      res = await cloud.getComments(diaryId);
    } catch (err) {
      console.error('[DiaryDetail] 加载评论失败:', err);
      return;
    }

    if (!res || !res.data) { console.warn('[DiaryDetail] 评论数据为空'); return; }
    const rawComments = res.data;
    console.log('[DiaryDetail] 原始评论数:', rawComments.length);
    rawComments.forEach((c, i) => {
      console.log(`[DiaryDetail]   评论${i}:`, '_id=' + c._id, 'userId=' + c.userId,
        'nickname=' + c.nickname, 'avatar=' + (c.avatar ? '(有)' : '(无)'));
    });

    // 收集所有不重复的 userId
    const userIds = [...new Set(rawComments.map(c => c.userId).filter(Boolean))];
    console.log('[DiaryDetail] 需要查的用户IDs:', JSON.stringify(userIds));

    // 批量从 users 表查资料 → { openid: { nickName, avatarUrl } }
    // 用 openid 字段匹配，同时兼容 _id 就是 openid 的情况
    let userMap = {};
    if (userIds.length > 0) {
      try {
        // 优先用 openid 字段查
        const userRes = await db.collection('users').where(
          db.command.or([
            { openid: db.command.in(userIds) },
            { _id: db.command.in(userIds) }
          ])
        ).get();
        (userRes.data || []).forEach(u => {
          const key = u.openid || u._id;
          userMap[key] = {
            nickName: u.nickName || '',
            avatarUrl: u.avatarUrl || ''
          };
          if (u._id && userIds.includes(u._id)) {
            userMap[u._id] = {
              nickName: u.nickName || '',
              avatarUrl: u.avatarUrl || ''
            };
          }
        });
        console.log('[DiaryDetail] 通过openid/_id查到用户数:', Object.keys(userMap).length);

        // 将 cloud:// 头像链接批量转为临时HTTP链接
        const cloudAvatarIds = [];
        Object.values(userMap).forEach(u => {
          if (u.avatarUrl && u.avatarUrl.startsWith('cloud://')) {
            cloudAvatarIds.push(u.avatarUrl);
          }
        });
        if (cloudAvatarIds.length > 0) {
          try {
            const tempUrls = await cloud.getTempFileURLs(cloudAvatarIds);
            const urlMap = {};
            cloudAvatarIds.forEach((fid, idx) => { urlMap[fid] = tempUrls[idx] || fid; });
            Object.keys(userMap).forEach(key => {
              const u = userMap[key];
              if (u.avatarUrl && urlMap[u.avatarUrl]) {
                u.avatarUrl = urlMap[u.avatarUrl];
              }
            });
            console.log('[DiaryDetail] cloud://头像转临时链接完成');
          } catch (err) {
            console.warn('[DiaryDetail] 头像临时链接转换失败:', err.errMsg);
          }
        }

        Object.keys(userMap).forEach(uid => {
          console.log(`[DiaryDetail]   用户 ${uid.slice(-8)}: nickName="${userMap[uid].nickName}", avatar=${userMap[uid].avatarUrl ? '(有)' : '(无)'}`);
        });
      } catch (err) {
        console.warn('[DiaryDetail] 查询用户失败:', err.errMsg);
      }
    }

    // 组装最终评论列表
    const comments = rawComments.map(item => {
      const timeStr = item.createdAt ? this._formatTime(item.createdAt) : '';

      // 从 users 表获取该评论者的资料
      const uInfo = item.userId ? userMap[item.userId] : null;

      // 有用户资料就用用户的，否则 fallback
      let nickName, avatar, source;
      if (uInfo && uInfo.nickName) {
        nickName = uInfo.nickName;
        avatar = uInfo.avatarUrl;
        source = 'users表';
      }
      // 兼容旧数据（旧评论存了 nickname 字段但没存 userId）
      else if (item.nickname && item.nickname !== '我' && item.nickname !== '匿名') {
        nickName = item.nickname;
        avatar = item.avatar || '';
        source = '旧数据兼容';
      }
      else {
        // 完全没信息：用 userId 后8位兜底
        nickName = item.userId ? item.userId.slice(-8) : '匿名';
        avatar = '';
        source = 'FALLBACK(匿名)';
      }

      if (!avatar) {
        avatar = 'https://picsum.photos/80/80?random=' + Math.abs(item.userId ? this._hashCode(item.userId) : Date.now()) % 1000;
      }

      console.log(`[DiaryDetail] 最终显示: "${nickName}" [来源:${source}] 头像=${avatar.startsWith('cloud://') ? '云存储' : (avatar.includes('picsum') ? '随机' : '其他')}`);

      return {
        id: item._id,
        userId: item.userId,
        avatar,
        nickname: nickName,
        content: item.content,
        time: timeStr,
        likeCount: item.likeCount || 0
      };
    });

    this.setData({ comments });
  },

  // 简单字符串哈希（用于随机头像确定性生成，同一用户每次显示相同头像）
  _hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
  },

  _formatTime(d) {
    const date = d instanceof Date ? d : new Date(d);
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0') + ' ' +
      String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0');
  },

  onShow() {
    if (this._diaryId) {
      const updatedData = wx.getStorageSync('diaryUpdated_' + this._diaryId);
      if (updatedData) {
        wx.removeStorageSync('diaryUpdated_' + this._diaryId);
        this._applyDiaryData(updatedData);
      }
    }
  },

  _reloadDiary(id) {
    cloud.getDiary(id).then(res => {
      const data = res.data;
      const allImageIds = [];
      if (data.coverImage && data.coverImage.startsWith('cloud://')) allImageIds.push(data.coverImage);
      (data.images || []).forEach(img => { if (img && img.startsWith('cloud://')) allImageIds.push(img); });

      const applyData = (d) => {
        this.setData({ diary: d, likeCount: d.likeCount || 0 });
      };

      if (allImageIds.length > 0) {
        cloud.getTempFileURLs(allImageIds).then(tempURLs => {
          let idx = 0;
          if (data.coverImage && data.coverImage.startsWith('cloud://')) data.coverImage = tempURLs[idx++];
          data.images = (data.images || []).map(img => (img && img.startsWith('cloud://')) ? tempURLs[idx++] : img);
          applyData(data);
        });
      } else {
        applyData(data);
      }
    }).catch(err => {
      console.error('重新加载日记失败:', err);
    });
  },

  openLocation() {
    const diary = this.data.diary;
    const loc = diary.locationData;
    if (loc && loc.latitude && loc.longitude) {
      wx.openLocation({ latitude: loc.latitude, longitude: loc.longitude, name: loc.name || '', address: loc.address || '' });
    } else if (diary._id) {
      // locationData 可能在传递过程中丢失，从数据库重新查
      wx.showLoading({ title: '加载位置...', mask: true });
      db.collection('diaries').doc(diary._id).get().then(res => {
        wx.hideLoading();
        const freshData = res.data;
        if (freshData && freshData.locationData && freshData.locationData.latitude) {
          // 更新本地数据
          diary.locationData = freshData.locationData;
          this.setData({ diary });
          wx.openLocation({
            latitude: freshData.locationData.latitude,
            longitude: freshData.locationData.longitude,
            name: freshData.locationData.name || '',
            address: freshData.locationData.address || ''
          });
        } else {
          wx.showToast({ title: '位置信息不完整，无法打开地图', icon: 'none' });
        }
      }).catch(err => {
        wx.hideLoading();
        console.error('[DiaryDetail] 查询位置数据失败:', err);
        wx.showToast({ title: '获取位置失败', icon: 'none' });
      });
    } else if (diary.location) {
      wx.showToast({ title: '位置信息不完整，无法打开地图', icon: 'none' });
    }
  },

  toggleLike() {
    const liked = !this.data.liked;
    const likeCount = liked ? this.data.likeCount + 1 : this.data.likeCount - 1;
    this.setData({ liked, likeCount });
    const diary = this.data.diary;
    if (diary._id) {
      db.collection('diaries').doc(diary._id).update({ data: { likeCount } }).catch(() => {});
    }
  },

  // 检查是否已收藏
  _checkFavorite(diaryId) {
    if (!diaryId) return;
    db.collection('favorites').where({ diaryId: diaryId }).limit(1).get().then(res => {
      if (res.data && res.data.length > 0) {
        this.setData({ isFav: true, favId: res.data[0]._id });
      } else {
        this.setData({ isFav: false, favId: '' });
      }
    }).catch(() => {
      this.setData({ isFav: false, favId: '' });
    });
  },

  // 收藏/取消收藏
  async toggleFavorite() {
    const diary = this.data.diary;
    if (!diary || !diary._id) {
      wx.showToast({ title: '示例日记暂不支持收藏', icon: 'none' });
      return;
    }

    if (this.data.isFav) {
      // 取消收藏
      try {
        if (this.data.favId) {
          await cloud.deleteFavorite(this.data.favId);
        } else {
          await cloud.deleteFavoriteByDiaryId(diary._id);
        }
        this.setData({ isFav: false, favId: '' });
        wx.showToast({ title: '已取消收藏', icon: 'success' });
      } catch (err) {
        console.error('取消收藏失败:', err);
        wx.showToast({ title: '操作失败', icon: 'none' });
      }
    } else {
      // 添加收藏
      try {
        const res = await cloud.addFavorite(diary._id, {
          title: diary.title,
          detail: diary.detail || '',
          date: diary.date || '',
          tag: diary.tag || '',
          mood: diary.mood || '',
          coverImage: diary.coverImage || ''
        });
        this.setData({ isFav: true, favId: res._id || '' });
        wx.showToast({ title: '已收藏', icon: 'success' });
      } catch (err) {
        console.error('收藏失败:', err);
        wx.showToast({ title: '收藏失败', icon: 'none' });
      }
    }
  },

  onMoreAction() {
    wx.showActionSheet({ itemList: ['编辑', '删除'], success: (res) => { if (res.tapIndex === 0) this.editDiary(); else if (res.tapIndex === 1) this.deleteDiary(); } });
  },

  editDiary() {
    const diary = this.data.diary;
    if (diary._id) {
      wx.navigateTo({ url: '/pages/add_anniversary/add_anniversary?edit=1&id=' + diary._id });
    } else {
      wx.showToast({ title: '示例日记暂不支持编辑', icon: 'none' });
    }
  },

  deleteDiary() {
    wx.showModal({
      title: '确认删除',
      content: '删除后将放入回收站，可在"我的"中恢复',
      confirmColor: '#ff4757',
      success: (res) => {
        if (res.confirm) {
          const diary = this.data.diary;
          if (diary._id) {
            let recycleDiaries = wx.getStorageSync('recycleDiaries') || [];
            recycleDiaries.push({ id: diary._id, title: diary.title, date: diary.date, deletedAt: new Date().toLocaleString(), originalData: { title: diary.title, detail: diary.detail, date: diary.date, images: diary.images || [], coverImage: diary.coverImage || '', summary: diary.summary || '', tag: diary.tag || '', mood: diary.mood || '', weather: diary.weather || '', location: diary.location || '', content: diary.content || [], likeCount: diary.likeCount || 0 } });
            wx.setStorageSync('recycleDiaries', recycleDiaries);
            Promise.all([cloud.deleteDiary(diary._id), cloud.deleteCommentsByDiaryId(diary._id).catch(() => {})]).then(() => { wx.setStorageSync('needRefreshHome', true); wx.showToast({ title: '已移至回收站', icon: 'success' }); setTimeout(() => { wx.navigateBack({ delta: 1 }); }, 1000); }).catch(() => { wx.setStorageSync('needRefreshHome', true); wx.showToast({ title: '已移至回收站', icon: 'success' }); setTimeout(() => { wx.navigateBack({ delta: 1 }); }, 1000); });
          } else {
            let deleted = wx.getStorageSync('deletedDiaryDates') || [];
            deleted.push(diary.date + '_' + diary.title);
            wx.setStorageSync('deletedDiaryDates', deleted);
            wx.setStorageSync('needRefreshHome', true);
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => { wx.navigateBack({ delta: 1 }); }, 1000);
          }
        }
      }
    });
  },

  toggleCommentInput() { this.setData({ showCommentInput: !this.data.showCommentInput }); },

  deleteComment(e) {
    const index = e.currentTarget.dataset.index;
    const comment = this.data.comments[index];
    if (!comment || !comment.id) return;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条评论吗？',
      success: (res) => {
        if (res.confirm) {
          if (comment.id.startsWith('demo_')) {
            const comments = [...this.data.comments];
            comments.splice(index, 1);
            this.setData({ comments });
            wx.showToast({ title: '已删除', icon: 'success' });
          } else {
            db.collection('comments').doc(comment.id).remove().then(() => {
              const comments = [...this.data.comments];
              comments.splice(index, 1);
              this.setData({ comments });
              wx.showToast({ title: '已删除', icon: 'success' });
            }).catch(err => { console.error('删除评论失败:', err); wx.showToast({ title: '删除失败', icon: 'none' }); });
          }
        }
      }
    });
  },

  onCommentInput(e) { this.setData({ commentText: e.detail.value }); },

  async submitComment() {
    const text = this.data.commentText.trim();
    if (!text) { wx.showToast({ title: '请输入评论内容', icon: 'none' }); return; }

    const diary = this.data.diary;
    const diaryId = diary._id || ('demo_' + diary.date + '_' + diary.title);

    try {
      // 只传内容，服务端自动记录当前 userId
      await cloud.addComment(diaryId, { content: text });
    } catch (err) {
      console.error('评论保存失败:', JSON.stringify(err));
      wx.showToast({ title: '评论保存失败，请检查comments集合权限', icon: 'none', duration: 3000 });
      return;
    }

    // 新评论即时显示：用当前用户的真实资料
    const myProfile = await userProfile.get();
    const myUserId = wx.getStorageSync('userId') || '';
    const myNickName = (myProfile.nickName && myProfile.nickName.trim())
      ? myProfile.nickName.trim()
      : (myUserId ? myUserId.slice(-8) : '我');
    let myAvatar = myProfile.avatarUrl || '';
    // cloud:// 头像需要转为临时HTTP链接
    if (myAvatar && myAvatar.startsWith('cloud://')) {
      try {
        const tempUrls = await cloud.getTempFileURLs([myAvatar]);
        myAvatar = tempUrls[0] || myAvatar;
      } catch (e) {
        console.warn('[DiaryDetail] 当前用户头像临时链接转换失败:', e);
      }
    }
    if (!myAvatar) {
      myAvatar = 'https://picsum.photos/80/80?random=' + Date.now();
    }

    const now = new Date();
    const timeStr = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');

    const newComment = {
      id: Date.now(),
      userId: myUserId,
      avatar: myAvatar,
      nickname: myNickName,
      content: text,
      time: timeStr,
      likeCount: 0
    };

    const comments = [newComment, ...this.data.comments];
    this.setData({ comments, commentText: '', showCommentInput: false });
    wx.showToast({ title: '评论成功', icon: 'success' });
  },

  previewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.diary.images || [] });
  },

  onShareAppMessage() {
    return { title: this.data.diary.title, path: '/pages/index/index' };
  }
})
