// pages/period/period.js
const cloud = require('../../utils/cloud.js')

Page({
  data: {
    year: 0, month: 0, days: [], weekDays: ['日','一','二','三','四','五','六'],
    records: [],
    selectedDate: '',
    selectedDayRecords: [],
    isDragging: false,
    dragStartDate: '',
    dragEndDate: ''
  },

  onLoad() { this._init(); },
  onShow() { this._refreshAll(); },

  _init() {
    const now = new Date();
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1 });
    this._refreshAll();
  },

  async _refreshAll() {
    const { year, month, selectedDate, isDragging, dragStartDate, dragEndDate } = this.data;
    let records = [];
    try {
      const res = await cloud.getPeriodRecords();
      records = (res.data || []).map(r => ({
        _id: r._id,
        id: r._id,
        type: r.type,
        startDate: r.startDate,
        endDate: r.endDate || r.startDate,
        createTime: r.createTime
      }));
    } catch (err) {
      console.error('加载健康记录失败:', err);
    }

    const now = new Date(); now.setHours(0,0,0,0);
    const firstDay = new Date(year, month - 1, 1).getDay();
    const totalDays = new Date(year, month, 0).getDate();

    const dateMap = {};
    records.forEach(r => {
      const s = new Date(r.startDate + 'T00:00:00');
      const e = new Date((r.endDate || r.startDate) + 'T00:00:00');
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        const ds = this._ds(d);
        if (!dateMap[ds]) dateMap[ds] = [];
        dateMap[ds].push(r);
      }
    });

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push({ day: 0 });

    for (let d = 1; d <= totalDays; d++) {
      const ds = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayRecs = dateMap[ds] || [];

      let isInRange = false;
      if (isDragging && dragStartDate && dragEndDate) {
        const min = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
        const max = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;
        isInRange = ds >= min && ds <= max;
      }

      days.push({
        day: d,
        date: ds,
        isToday: new Date(year, month-1, d).getTime() === now.getTime(),
        isSelected: ds === selectedDate && !isDragging,
        isInRange,
        hasPeriod: dayRecs.some(r => r.type === 'period'),
        hasLove: dayRecs.some(r => r.type === 'intercourse'),
        hasOvu: dayRecs.some(r => r.type === 'ovulation'),
        recordCount: dayRecs.length
      });
    }

    let selectedDayRecords = [];
    if (selectedDate && !isDragging) {
      selectedDayRecords = records.filter(r => {
        const start = r.startDate;
        const end = r.endDate || r.startDate;
        return selectedDate >= start && selectedDate <= end;
      });
    }

    this.setData({ days, records, selectedDayRecords });
  },

  _ds(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  prevMonth() {
    let { year, month } = this.data;
    month--; if (month < 1) { month = 12; year--; }
    this.setData({ year, month, isDragging: false, dragStartDate: '', dragEndDate: '' });
    this._refreshAll();
  },

  nextMonth() {
    let { year, month } = this.data;
    month++; if (month > 12) { month = 1; year++; }
    this.setData({ year, month, isDragging: false, dragStartDate: '', dragEndDate: '' });
    this._refreshAll();
  },

  onDayTap(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    if (this.data.isDragging) return;
    this.setData({
      selectedDate: date,
      isDragging: false,
      dragStartDate: '',
      dragEndDate: ''
    });
    this._refreshAll();
  },

  onDayLongPress(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({
      isDragging: true,
      dragStartDate: date,
      dragEndDate: date,
      selectedDate: ''
    });
    this._refreshAll();
    wx.vibrateShort({ type: 'light' });
  },

  onContainerTouchMove(e) {
    if (!this.data.isDragging) return;
    const touches = e.touches;
    if (!touches || touches.length === 0) return;
    const touch = touches[0];
    this._findDateAtPoint(touch.pageX, touch.pageY);
  },

  _findDateAtPoint(pageX, pageY) {
    const query = wx.createSelectorQuery();
    query.selectAll('.day-cell').fields({
      rect: true,
      dataset: true,
      size: true
    }).exec((res) => {
      const rects = res[0];
      if (!rects) return;
      for (const rect of rects) {
        if (pageX >= rect.left && pageX <= rect.right &&
            pageY >= rect.top && pageY <= rect.bottom) {
          const date = rect.dataset?.date;
          if (date && date !== this.data.dragEndDate) {
            this.setData({ dragEndDate: date });
            this._refreshAll();
          }
          break;
        }
      }
    });
  },

  onTouchEnd() {
    if (!this.data.isDragging) return;
    this.setData({ isDragging: false });
    this._refreshAll();
  },

  clearSelect() {
    this.setData({
      selectedDate: '',
      selectedDayRecords: [],
      isDragging: false,
      dragStartDate: '',
      dragEndDate: ''
    });
    this._refreshAll();
  },

  async addMarkToSelected(e) {
    const type = e.currentTarget.dataset.type;
    const { selectedDate, records } = this.data;
    if (!selectedDate) {
      wx.showToast({ title: '请先点击选择日期', icon: 'none' });
      return;
    }

    const typeNames = { period: '经期', intercourse: '性生活', ovulation: '排卵期' };

    const exists = records.some(r => {
      if (r.type !== type) return false;
      const start = r.startDate;
      const end = r.endDate || r.startDate;
      return selectedDate >= start && selectedDate <= end;
    });

    if (exists) {
      wx.showToast({ title: `已有${typeNames[type]}标记`, icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      await cloud.addPeriodRecord({
        type,
        startDate: selectedDate,
        endDate: selectedDate
      });
      wx.hideLoading();
      this._refreshAll();
      wx.showToast({ title: `已添加${typeNames[type]}`, icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('添加健康记录失败:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  deleteSingleRecord(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...', mask: true });
          try {
            await cloud.deletePeriodRecord(id);
            wx.hideLoading();
            this._refreshAll();
            wx.showToast({ title: '已删除', icon: 'success' });
          } catch (err) {
            wx.hideLoading();
            console.error('删除健康记录失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  async markRangeAsType(e) {
    const type = e.currentTarget.dataset.type;
    const { dragStartDate, dragEndDate, records } = this.data;
    if (!dragStartDate) {
      wx.showToast({ title: '请先选择范围', icon: 'none' });
      return;
    }

    const typeNames = { period: '经期', intercourse: '性生活', ovulation: '排卵期' };
    const start = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const end = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      await cloud.addPeriodRecord({
        type,
        startDate: start,
        endDate: end
      });
      wx.hideLoading();
      this.setData({ dragStartDate: '', dragEndDate: '', isDragging: false });
      this._refreshAll();
      wx.showToast({ title: `${typeNames[type]}已记录`, icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('添加范围记录失败:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  deleteRangeRecords() {
    const { dragStartDate, dragEndDate } = this.data;
    if (!dragStartDate) {
      wx.showToast({ title: '请先选择范围', icon: 'none' });
      return;
    }

    const start = dragStartDate < dragEndDate ? dragStartDate : dragEndDate;
    const end = dragStartDate < dragEndDate ? dragEndDate : dragStartDate;

    wx.showModal({
      title: '确认删除',
      content: `确定删除 ${start}${end !== start ? ' ~ ' + end : ''} 的所有记录？`,
      confirmColor: '#e74c3c',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...', mask: true });
          try {
            await cloud.deletePeriodRecordsInRange(start, end);
            wx.hideLoading();
            this.setData({ dragStartDate: '', dragEndDate: '', isDragging: false });
            this._refreshAll();
            wx.showToast({ title: '已删除', icon: 'success' });
          } catch (err) {
            wx.hideLoading();
            console.error('删除范围记录失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  }
})
