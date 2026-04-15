// pages/memo/memo.js
const cloud = require('../../utils/cloud.js')

Page({
  data: { memos: [], showAdd: false, title: '', content: '', loading: true },

  onLoad() { this._load(); },
  onShow() { this._load(); },

  async _load() {
    try {
      const res = await cloud.getMemos();
      const memos = (res.data || []).map(m => ({
        _id: m._id,
        id: m._id,
        title: m.title,
        content: m.content || '',
        color: m.color || '#FFF9C4',
        createdAt: m.createdAt ? new Date(m.createdAt).toLocaleString() : ''
      }));
      this.setData({ memos, loading: false });
    } catch (err) {
      console.error('加载备忘录失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  toggleAdd() { this.setData({ showAdd: !this.data.showAdd, title: '', content: '' }); },
  onTitleInput(e) { this.setData({ title: e.detail.value }); },
  onContentInput(e) { this.setData({ content: e.detail.value }); },

  async addMemo() {
    const { title, content } = this.data;
    if (!title.trim()) { wx.showToast({ title: '请输入标题', icon: 'none' }); return; }
    const colors = ['#FFF9C4', '#F8BBD0', '#C8E6C9', '#BBDEFB', '#D1C4E9'];
    const color = colors[Math.floor(Math.random() * colors.length)];

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      await cloud.addMemo({ title: title.trim(), content: content.trim(), color });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });
      // 成功后再清空并刷新
      this.setData({ showAdd: false, title: '', content: '' });
      this._load();
    } catch (err) {
      wx.hideLoading();
      console.error('添加备忘录失败:', err);
      // 失败时不清空表单，让用户可以重试
      wx.showToast({ title: '保存失败，请检查网络', icon: 'none' });
    }
  },

  deleteMemo(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({ title: '确认删除', content: '确定要删除这条备忘录吗？', success: async (res) => {
      if (res.confirm) {
        wx.showLoading({ title: '删除中...', mask: true });
        try {
          await cloud.deleteMemo(id);
          wx.hideLoading();
          this._load();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (err) {
          wx.hideLoading();
          console.error('删除备忘录失败:', err);
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    }});
  }
})
