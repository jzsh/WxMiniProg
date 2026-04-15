// pages/favorites/favorites.js
const cloud = require('../../utils/cloud.js')

Page({
  data: {
    favorites: [],
    loading: true
  },

  onShow() {
    this.loadFavorites();
  },

  async loadFavorites() {
    try {
      const res = await cloud.getFavorites();
      const favorites = (res.data || []).map(f => ({
        _id: f._id,
        id: f._id,
        diaryId: f.diaryId || '',
        title: f.title || '',
        detail: f.detail || '',
        date: f.date || '',
        tag: f.tag || '',
        mood: f.mood || '',
        coverImage: f.coverImage || '',
        createdAt: f.createdAt
      }));
      this.setData({ favorites, loading: false });
    } catch (err) {
      console.error('加载收藏失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onItemTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.favorites[index];
    if (!item) return;
    // 如果有 diaryId，跳转到日记详情页并传递日记ID
    if (item.diaryId) {
      wx.navigateTo({
        url: `/pages/diary_detail/diary_detail?id=${item.diaryId}`
      });
    } else {
      wx.navigateTo({
        url: '/pages/diary_detail/diary_detail',
        success: (res) => {
          res.eventChannel.emit('diaryData', item);
        }
      });
    }
  },

  onRemoveFavorite(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.favorites[index];
    if (!item) return;
    wx.showModal({
      title: '提示',
      content: '确定要取消收藏吗？',
      confirmColor: '#00b26a',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...', mask: true });
          try {
            await cloud.deleteFavorite(item._id || item.id);
            wx.hideLoading();
            this.loadFavorites();
            wx.showToast({ title: '已取消收藏', icon: 'success' });
          } catch (err) {
            wx.hideLoading();
            console.error('取消收藏失败:', err);
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  }
});
