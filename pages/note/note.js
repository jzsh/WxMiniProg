// pages/note/note.js
const cloud = require('../../utils/cloud');

Page({
  data: {
    // 纪念日倒数
    anniversaries: [],
    countdownList: [],
    showAddAnniversary: false,
    newAnnName: '',
    newAnnDate: '',
    newAnnIcon: '🎉',
    // 情侣100件事
    coupleThingsDone: 0,
    coupleThingsTotal: 100,
    // 便利贴
    stickyNotes: [],
    showAddNote: false,
    noteText: '',
    // 快捷入口
    quickEntries: [],
    showAddQuick: false,
    newQuickIcon: '📌',
    newQuickName: '',
    // 爱好标签
    hobbies: [],
    showAddHobby: false,
    newHobby: ''
  },

  onLoad() {
    this._calcCountdown();
    this._loadCoupleThingsProgress();
  },

  // 加载情侣100件事进度
  _loadCoupleThingsProgress() {
    cloud.getCoupleThingsProgress().then(res => {
      const completedCount = (res.data || []).filter(item => item.completed).length;
      this.setData({ coupleThingsDone: completedCount });
    }).catch(err => {
      console.error('加载情侣100件事进度失败:', err);
      this.setData({ coupleThingsDone: 0 });
    });
  },

  onShow() {
    this._loadAllData();
  },

  // 从云数据库加载所有数据
  _loadAllData() {
    wx.showLoading({ title: '加载中...' });
    Promise.all([
      cloud.getStickyNotes(),
      cloud.getAnniversaries(),
      cloud.getQuickEntries(),
      cloud.getHobbies()
    ]).then(([notesRes, annivRes, quickRes, hobbiesRes]) => {
      // 处理便利贴数据，添加time字段（月-日格式）
      const stickyNotes = (notesRes.data || []).map(note => {
        const date = new Date(note.createTime);
        const timeStr = String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
        return {
          id: note._id,
          color: note.color,
          text: note.text,
          time: timeStr
        };
      });

      // 处理纪念日数据
      const anniversaries = annivRes.data || [];

      // 处理快捷入口数据
      const quickEntries = quickRes.data || [];

      // 处理爱好标签数据
      const hobbies = (hobbiesRes.data || []).map(hobby => hobby.name);

      this.setData({ 
        stickyNotes: stickyNotes.length > 0 ? stickyNotes : this._defaultStickyNotes(),
        anniversaries: anniversaries.length > 0 ? anniversaries : this._defaultAnniversaries(),
        quickEntries: quickEntries.length > 0 ? quickEntries : this._defaultQuickEntries(),
        hobbies: hobbies.length > 0 ? hobbies : this._defaultHobbies()
      });
      this._calcCountdown();
      wx.hideLoading();
    }).catch(err => {
      console.error('加载数据失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '加载失败', icon: 'none' });
      // 加载失败时使用默认数据
      this.setData({
        stickyNotes: this._defaultStickyNotes(),
        anniversaries: this._defaultAnniversaries(),
        quickEntries: this._defaultQuickEntries(),
        hobbies: this._defaultHobbies()
      });
      this._calcCountdown();
    });
  },

  _defaultStickyNotes() {
    return [
      { id: 'demo1', color: '#FFF9C4', text: '周末一起去吃那家新开的日料！', time: '03-30' },
      { id: 'demo2', color: '#F8BBD0', text: '记得给妈妈买生日蛋糕🎂', time: '03-28' },
      { id: 'demo3', color: '#C8E6C9', text: '下周三下午3点看牙医', time: '03-27' }
    ];
  },

  _defaultAnniversaries() {
    return [
      { name: '生日', date: '2026-05-15', icon: '🎂' },
      { name: '在一起1000天', date: '2026-08-20', icon: '💕' },
      { name: '纪念日', date: '2026-07-07', icon: '🌹' }
    ];
  },

  _defaultQuickEntries() {
    return [
      { icon: '🌸', name: '健康记录', page: '/pages/period/period' },  // 改名
      { icon: '🗒️', name: '备忘录', page: '/pages/memo/memo' },
      { icon: '⏰', name: '提醒设置', page: '' },
      { icon: '🔒', name: '私密空间', page: '/pages/secret/secret' },
      { icon: '💝', name: '我的爱好', page: '' },
      { icon: '🎯', name: '小目标', page: '/pages/goals/goals' }
    ];
  },

  _defaultHobbies() {
    return ['📚 阅读', '🏃 跑步', '🎮 游戏', '🎵 音乐', '🍳 烘焙'];
  },

  _defaultAnniversaries() {
    return [
      { name: '生日', date: '2026-05-15', icon: '🎂' },
      { name: '在一起1000天', date: '2026-08-20', icon: '💕' },
      { name: '纪念日', date: '2026-07-07', icon: '🌹' }
    ];
  },

  // 计算倒数天数
  _calcCountdown() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const anniversaries = this.data.anniversaries;
    if (!anniversaries || anniversaries.length === 0) return;
    const countdownList = anniversaries.map(item => {
      const target = new Date(item.date);
      target.setHours(0, 0, 0, 0);
      let diff = target - now;
      let days = Math.ceil(diff / (1000 * 60 * 60 * 24));
      
      // 如果日期已过，一直加到明年或未来的日期
      if (days < 0) {
        // 不断加年份，直到日期在未来
        while (days < 0) {
          target.setFullYear(target.getFullYear() + 1);
          diff = target - now;
          days = Math.ceil(diff / (1000 * 60 * 60 * 24));
        }
      }
      return { ...item, days };
    });
    countdownList.sort((a, b) => a.days - b.days);
    this.setData({ countdownList });
  },

  // ========== 纪念日管理 ==========
  toggleAddAnniversary() {
    this.setData({ showAddAnniversary: !this.data.showAddAnniversary, newAnnName: '', newAnnDate: '' });
  },
  onAnnNameInput(e) { this.setData({ newAnnName: e.detail.value }); },
  onAnnDateChange(e) { this.setData({ newAnnDate: e.detail.value }); },
  selectAnnIcon() {
    const icons = ['🎂', '💕', '🌹', '🎉', '💍', '🏠', '✈️', '🎂', '🎁', '🌸', '⭐', '🎊'];
    wx.showActionSheet({ itemList: icons, success: (res) => { this.setData({ newAnnIcon: icons[res.tapIndex] }); } });
  },
  addAnniversary() {
    const { newAnnName, newAnnDate, newAnnIcon } = this.data;
    if (!newAnnName.trim() || !newAnnDate) { wx.showToast({ title: '请填写名称和日期', icon: 'none' }); return; }
    
    wx.showLoading({ title: '添加中...' });
    cloud.addAnniversary({
      name: newAnnName.trim(),
      date: newAnnDate,
      icon: newAnnIcon
    }).then(res => {
      wx.hideLoading();
      this._loadAllData();
      this.setData({ showAddAnniversary: false, newAnnName: '', newAnnDate: '' });
      wx.showToast({ title: '添加成功', icon: 'success' });
    }).catch(err => {
      wx.hideLoading();
      console.error('添加纪念日失败:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  },
  
  deleteAnniversary(item) {
    // item 可能来自 countdownList 的项目对象
    if (!item) return;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个纪念日吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          // 如果有 _id，调用云端删除
          if (item._id) {
            cloud.deleteAnniversary(item._id).then(() => {
              wx.hideLoading();
              this._loadAllData();
              wx.showToast({ title: '删除成功', icon: 'success' });
            }).catch(err => {
              wx.hideLoading();
              console.error('删除纪念日失败:', err);
              wx.showToast({ title: '删除失败', icon: 'none' });
            });
          } else {
            // 默认数据，从本地 anniversaries 中移除
            const anniversaries = this.data.anniversaries.filter(a => 
              !(a.name === item.name && a.date === item.date)
            );
            this.setData({ anniversaries }, () => {
              this._calcCountdown();
              wx.hideLoading();
              wx.showToast({ title: '删除成功', icon: 'success' });
            });
          }
        }
      }
    });
  },
  
  // 纪念日长按删除
  onAnniversaryLongPress(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.countdownList[index];
    if (item) {
      this.deleteAnniversary(item);
    }
  },

  // 100件事点击
  onCoupleThingsTap() {
    wx.navigateTo({ url: '/pages/couple_things/couple_things' });
  },

  // 显示添加便利贴输入
  toggleAddNote() {
    this.setData({ showAddNote: !this.data.showAddNote, noteText: '' });
  },

  onNoteInput(e) {
    this.setData({ noteText: e.detail.value });
  },

  // 添加便利贴
  addNote() {
    const text = this.data.noteText.trim();
    if (!text) return;
    const colors = ['#FFF9C4', '#F8BBD0', '#C8E6C9', '#BBDEFB', '#D1C4E9', '#FFE0B2'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    wx.showLoading({ title: '添加中...' });
    cloud.addStickyNote({ text, color }).then(res => {
      wx.hideLoading();
      this._loadAllData(); // 重新加载数据
      this.setData({ showAddNote: false, noteText: '' });
      wx.showToast({ title: '添加成功', icon: 'success' });
    }).catch(err => {
      wx.hideLoading();
      console.error('添加便利贴失败:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  },

  // 删除便利贴
  deleteNote(e) {
    const id = e.currentTarget.dataset.id;
    // 如果是演示数据，直接本地删除
    if (id.startsWith('demo')) {
      const notes = this.data.stickyNotes.filter(n => n.id !== id);
      this.setData({ stickyNotes: notes });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个便利贴吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          cloud.deleteStickyNote(id).then(() => {
            wx.hideLoading();
            this._loadAllData();
            wx.showToast({ title: '删除成功', icon: 'success' });
          }).catch(err => {
            wx.hideLoading();
            console.error('删除便利贴失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // ========== 快捷入口 ==========
  onQuickTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.quickEntries[index];
    if (item.page) {
      wx.navigateTo({ url: item.page, fail: () => { wx.showToast({ title: item.name + ' 开发中', icon: 'none' }); } });
    } else {
      wx.showToast({ title: item.name + ' 开发中', icon: 'none' });
    }
  },
  toggleAddQuick() {
    this.setData({ showAddQuick: !this.data.showAddQuick, newQuickName: '' });
  },
  onQuickNameInput(e) { this.setData({ newQuickName: e.detail.value }); },
  addQuickEntry() {
    const { newQuickName, newQuickIcon } = this.data;
    if (!newQuickName.trim()) { wx.showToast({ title: '请输入名称', icon: 'none' }); return; }
    
    wx.showLoading({ title: '添加中...' });
    cloud.addQuickEntry({
      icon: newQuickIcon,
      name: newQuickName.trim(),
      page: ''
    }).then(res => {
      wx.hideLoading();
      this._loadAllData();
      this.setData({ showAddQuick: false, newQuickName: '' });
      wx.showToast({ title: '添加成功', icon: 'success' });
    }).catch(err => {
      wx.hideLoading();
      console.error('添加快捷入口失败:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  },
  
  deleteQuickEntry(e) {
    const index = e.currentTarget.dataset.index;
    const entry = this.data.quickEntries[index];
    if (!entry._id) return;
    
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个快捷入口吗？',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });
          cloud.deleteQuickEntry(entry._id).then(() => {
            wx.hideLoading();
            this._loadAllData();
            wx.showToast({ title: '删除成功', icon: 'success' });
          }).catch(err => {
            wx.hideLoading();
            console.error('删除快捷入口失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          });
        }
      }
    });
  },

  // ========== 爱好管理 ==========
  toggleAddHobby() {
    this.setData({ showAddHobby: !this.data.showAddHobby, newHobby: '' });
  },
  onHobbyInput(e) { this.setData({ newHobby: e.detail.value }); },
  addHobby() {
    const { newHobby } = this.data;
    if (!newHobby.trim()) { wx.showToast({ title: '请输入爱好', icon: 'none' }); return; }
    
    wx.showLoading({ title: '添加中...' });
    cloud.addHobby({ name: '💡 ' + newHobby.trim() }).then(res => {
      wx.hideLoading();
      this._loadAllData();
      this.setData({ showAddHobby: false, newHobby: '' });
      wx.showToast({ title: '添加成功', icon: 'success' });
    }).catch(err => {
      wx.hideLoading();
      console.error('添加爱好失败:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    });
  },
  
  deleteHobby(e) {
    const index = e.currentTarget.dataset.index;
    const hobbyName = this.data.hobbies[index];
    
    // 查找对应的ID
    wx.showLoading({ title: '删除中...' });
    cloud.getHobbies().then(res => {
      const hobby = (res.data || []).find(h => h.name === hobbyName);
      if (hobby && hobby._id) {
        return cloud.deleteHobby(hobby._id);
      }
      throw new Error('找不到该爱好');
    }).then(() => {
      wx.hideLoading();
      this._loadAllData();
      wx.showToast({ title: '删除成功', icon: 'success' });
    }).catch(err => {
      wx.hideLoading();
      console.error('删除爱好失败:', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    });
  }
})
