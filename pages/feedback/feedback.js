// pages/feedback/feedback.js
const db = wx.cloud.database();
Page({
  data: { content: '', contact: '', submitted: false },
  onContentInput(e) { this.setData({ content: e.detail.value }); },
  onContactInput(e) { this.setData({ contact: e.detail.value }); },
  submit() {
    const { content, contact } = this.data;
    if (!content.trim()) { wx.showToast({ title: '请输入反馈内容', icon: 'none' }); return; }
    wx.showLoading({ title: '提交中...', mask: true });
    db.collection('feedback').add({ data: { content: content.trim(), contact: contact.trim(), createdAt: db.serverDate() } }).then(() => {
      this.setData({ submitted: true, content: '', contact: '' });
      wx.hideLoading();
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '提交失败', icon: 'none' });
    });
  }
})
