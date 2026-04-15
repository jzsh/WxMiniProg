// pages/recycle_bin/recycle_bin.js
const cloud = require('../../utils/cloud');

Page({
  data: {
    diaries: [],
    photos: []
  },

  onLoad() { this._loadData(); },
  onShow() { this._loadData(); },

  _loadData() {
    // 从本地存储读取回收站数据
    const recycleDiaries = wx.getStorageSync('recycleDiaries') || [];
    const recyclePhotos = wx.getStorageSync('recyclePhotos') || [];
    this.setData({ diaries: recycleDiaries, photos: recyclePhotos });
  },

  // 恢复日记
  restoreDiary(e) {
    const index = e.currentTarget.dataset.index;
    const diaries = this.data.diaries;
    const item = diaries.splice(index, 1)[0];
    wx.setStorageSync('recycleDiaries', diaries);
    this.setData({ diaries });
    // 恢复到云数据库
    if (item.originalData) {
      wx.cloud.database().collection('diaries').add({ data: { ...item.originalData, createdAt: new Date(item.deletedAt), updatedAt: new Date() } }).then(() => {
        wx.showToast({ title: '已恢复', icon: 'success' });
      }).catch(() => { wx.showToast({ title: '恢复失败', icon: 'none' }); });
    }
  },

  // 永久删除日记
  permanentDeleteDiary(e) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({ title: '永久删除', content: '确定要永久删除吗？此操作不可恢复。', confirmColor: '#ff4757', success: (res) => {
      if (res.confirm) {
        const diaries = this.data.diaries;
        diaries.splice(index, 1);
        wx.setStorageSync('recycleDiaries', diaries);
        this.setData({ diaries });
        wx.showToast({ title: '已永久删除', icon: 'none' });
      }
    }});
  },

  // 恢复照片
  restorePhoto(e) {
    const index = e.currentTarget.dataset.index;
    const photos = this.data.photos;
    const item = photos.splice(index, 1)[0];
    wx.setStorageSync('recyclePhotos', photos);
    this.setData({ photos });
    if (item.fileID) {
      wx.cloud.database().collection('photos').add({ data: { fileID: item.fileID, date: item.date || '', createdAt: new Date() } }).then(() => {
        wx.showToast({ title: '已恢复', icon: 'success' });
      }).catch(() => { wx.showToast({ title: '恢复失败', icon: 'none' }); });
    }
  },

  // 永久删除照片
  permanentDeletePhoto(e) {
    const index = e.currentTarget.dataset.index;
    wx.showModal({ title: '永久删除', content: '确定要永久删除吗？此操作不可恢复。', confirmColor: '#ff4757', success: (res) => {
      if (res.confirm) {
        const photos = this.data.photos;
        const item = photos.splice(index, 1)[0];
        wx.setStorageSync('recyclePhotos', photos);
        this.setData({ photos });
        // 也从云存储删除
        if (item.fileID) cloud.deleteFile(item.fileID).catch(() => {});
        wx.showToast({ title: '已永久删除', icon: 'none' });
      }
    }});
  },

  // 清空回收站
  clearAll() {
    wx.showModal({ title: '清空回收站', content: '确定要清空所有回收站内容吗？此操作不可恢复。', confirmColor: '#ff4757', success: (res) => {
      if (res.confirm) {
        wx.setStorageSync('recycleDiaries', []);
        wx.setStorageSync('recyclePhotos', []);
        this.setData({ diaries: [], photos: [] });
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    }});
  }
})
