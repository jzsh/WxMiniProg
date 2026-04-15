// pages/goals/goals.js
const cloud = require('../../utils/cloud.js')

Page({
  data: {
    goals: [],
    completedCount: 0,
    totalCount: 0,
    showAddModal: false,
    newGoal: {
      title: '',
      description: '',
      deadline: ''
    },
    loading: true
  },

  onLoad() {
    this.loadGoals()
  },

  onShow() {
    this.loadGoals()
  },

  async loadGoals() {
    try {
      const res = await cloud.getGoals();
      const goals = (res.data || []).map(g => ({
        _id: g._id,
        id: g._id,
        title: g.title,
        description: g.description || '',
        deadline: g.deadline || '',
        completed: g.completed || false,
        createdAt: g.createdAt
      }));
      const completedCount = goals.filter(g => g.completed).length;
      this.setData({ goals, completedCount, totalCount: goals.length, loading: false });
    } catch (err) {
      console.error('加载小目标失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onTitleInput(e) {
    this.setData({ 'newGoal.title': e.detail.value })
  },

  onDescInput(e) {
    this.setData({ 'newGoal.description': e.detail.value })
  },

  onDeadlineChange(e) {
    this.setData({ 'newGoal.deadline': e.detail.value })
  },

  openAddModal() {
    this.setData({ showAddModal: true })
  },

  closeAddModal() {
    this.setData({ showAddModal: false, newGoal: { title: '', description: '', deadline: '' } })
  },

  preventBubble() {
    // 空函数，仅用于阻止事件冒泡（catchtap 需要一个处理函数）
  },

  async addGoal() {
    const { newGoal } = this.data
    if (!newGoal.title.trim()) {
      wx.showToast({ title: '请输入目标标题', icon: 'none' })
      return
    }
    wx.showLoading({ title: '添加中...', mask: true });
    try {
      await cloud.addGoal({
        title: newGoal.title.trim(),
        description: newGoal.description.trim(),
        deadline: newGoal.deadline
      });
      wx.hideLoading();
      wx.showToast({ title: '添加成功', icon: 'success' });
      // 添加成功后再关闭弹窗并刷新
      this.closeAddModal();
      this.loadGoals();
    } catch (err) {
      wx.hideLoading();
      console.error('添加小目标失败:', err);
      // 添加失败时不关闭弹窗，让用户可以重试
      wx.showToast({ title: '添加失败，请检查网络', icon: 'none' });
    }
  },

  async toggleGoal(e) {
    const { id } = e.currentTarget.dataset
    const goal = this.data.goals.find(g => g.id === id)
    if (!goal) return
    const newCompleted = !goal.completed
    try {
      await cloud.updateGoalStatus(id, newCompleted);
      this.loadGoals();
    } catch (err) {
      console.error('更新目标状态失败:', err);
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  deleteGoal(e) {
    const { id } = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['删除此目标'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          wx.showLoading({ title: '删除中...', mask: true });
          try {
            await cloud.deleteGoal(id);
            wx.hideLoading();
            this.loadGoals();
            wx.showToast({ title: '已删除', icon: 'success' });
          } catch (err) {
            wx.hideLoading();
            console.error('删除小目标失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    })
  }
})
