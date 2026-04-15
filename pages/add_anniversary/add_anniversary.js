// pages/add_anniversary/add_anniversary.js
const cloud = require('../../utils/cloud');

Page({
  data: {
    title: '',
    detail: '',
    imageList: [],
    date: '',
    maxImageCount: 9,
    isEdit: false,
    editId: '',
    // 心情、天气、位置
    mood: '',
    weather: '',
    location: '',
    moodOptions: ['😊 开心', '😘 甜蜜', '😌 平静', '😢 伤心', '😡 生气', '🤔 思念', '😴 犯困', '🥰 幸福'],
    weatherOptions: ['☀️ 晴天', '⛅ 多云', '🌧️ 雨天', '❄️ 雪天', '🌈 彩虹', '🌙 夜晚', '💨 大风', '🌫️ 雾天'],
    showMoodPicker: false,
    showWeatherPicker: false,
    activeTagIndex: 0
  },

  onLoad(options) {
    const today = new Date();
    const dateStr = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');

    if (options.edit === '1' && options.id) {
      cloud.getDiary(options.id).then(res => {
        const diary = res.data;
        this.setData({
          title: diary.title || '',
          detail: diary.detail || (diary.content && diary.content.join('\n')) || '',
          date: diary.date || dateStr,
          imageList: diary.images || [],
          isEdit: true,
          editId: options.id,
          mood: diary.mood || '',
          weather: diary.weather || '',
          location: diary.location || '',
          locationData: diary.locationData || null
        });
        wx.setNavigationBarTitle({ title: '编辑纪念日' });
      }).catch(() => {
        wx.showToast({ title: '加载失败', icon: 'none' });
      });
    } else {
      this.setData({ date: dateStr });
    }
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },
  onDetailInput(e) { this.setData({ detail: e.detail.value }); },

  chooseImage() {
    const remaining = this.data.maxImageCount - this.data.imageList.length;
    if (remaining <= 0) {
      wx.showToast({ title: '最多上传' + this.data.maxImageCount + '张图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original', 'compressed'],
      success: (res) => {
        this.setData({ imageList: this.data.imageList.concat(res.tempFiles.map(f => f.tempFilePath)) });
      }
    });
  },

  previewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.imageList });
  },

  deleteImage(e) {
    const imageList = this.data.imageList;
    imageList.splice(e.currentTarget.dataset.index, 1);
    this.setData({ imageList });
  },

  onDateChange(e) { this.setData({ date: e.detail.value }); },

    // 心情选择
  selectMood() { 
    this.setData({ showMoodPicker: !this.data.showMoodPicker, showWeatherPicker: false }); 
  },
  chooseMood(e) { 
    this.setData({ mood: e.currentTarget.dataset.mood, showMoodPicker: false }); 
  },

  // 天气选择
  selectWeather() { 
    this.setData({ showWeatherPicker: !this.data.showWeatherPicker, showMoodPicker: false }); 
  },
  chooseWeather(e) { 
    this.setData({ weather: e.currentTarget.dataset.weather, showWeatherPicker: false }); 
  },

  // 位置选择
  chooseLocation() {
    // 先检查权限
    wx.getSetting({
      success: (res) => {
        if (!res.authSetting['scope.userLocation']) {
          // 未授权，先请求授权
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => {
              this._openMap();
            },
            fail: () => {
              wx.showModal({
                title: '需要位置权限',
                content: '请选择位置，需要您的地理位置权限',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) {
                    wx.openSetting();
                  }
                }
              });
            }
          });
        } else {
          this._openMap();
        }
      }
    });
  },

  _openMap() {
    // 不带任何参数，让微信使用默认的完整功能（包括搜索和移动图钉）
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: '📍 ' + res.name,
          locationData: {
            latitude: res.latitude,
            longitude: res.longitude,
            name: res.name,
            address: res.address || ''
          }
        });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.includes('auth')) {
          wx.showToast({ title: '请授权位置信息', icon: 'none' });
        } else if (err.errMsg && err.errMsg.includes('cancel')) {
          // 用户取消，不提示
        } else {
          wx.showToast({ title: '打开地图失败', icon: 'none' });
        }
      }
    });
  },

  async onPublish() {
    const { title, detail, imageList, date, isEdit, editId, mood, weather, location, locationData } = this.data;
    if (!title.trim()) { wx.showToast({ title: '请输入标题', icon: 'none' }); return; }
    if (!detail.trim()) { wx.showToast({ title: '请填写纪念日详情', icon: 'none' }); return; }
    if (!date) { wx.showToast({ title: '请选择日期', icon: 'none' }); return; }

    wx.showLoading({ title: '发布中...', mask: true });
    try {
      // 上传图片到云存储
      let cloudImages = [];
      if (imageList.length > 0) {
        const localImages = imageList.filter(img => !img.startsWith('cloud://'));
        const existCloudImages = imageList.filter(img => img.startsWith('cloud://'));
        if (localImages.length > 0) {
          wx.showLoading({ title: '上传图片中...', mask: true });
          const uploadResults = await cloud.uploadImages(localImages);
          cloudImages = existCloudImages.concat(uploadResults.map(r => r.fileID));
        } else {
          cloudImages = existCloudImages;
        }
      }

      const coverImage = cloudImages.length > 0 ? cloudImages[0] : '';

      if (isEdit && editId) {
        await cloud.updateDiary(editId, { title: title.trim(), detail: detail.trim(), date, images: cloudImages, coverImage, mood, weather, location, locationData, content: detail.trim().split('\n') });
        wx.showToast({ title: '修改成功', icon: 'success' });
        // 通过 storage 把更新后的数据传回详情页
        const updatedData = {
          _id: editId,
          title: title.trim(),
          detail: detail.trim(),
          date,
          images: cloudImages,
          coverImage,
          mood: mood,
          weather: weather,
          location: location,
          locationData: locationData,
          content: detail.trim().split('\n'),
          likeCount: this.data.likeCount || 0
        };
        wx.setStorageSync('diaryUpdated_' + editId, updatedData);
      } else {
        await cloud.addDiary({ title: title.trim(), detail: detail.trim(), date, images: cloudImages, coverImage, content: detail.trim().split('\n'), mood, weather, location, locationData });
        wx.showToast({ title: '发布成功', icon: 'success' });
      }
      // 标记首页需要刷新
      wx.setStorageSync('needRefreshHome', true);
      setTimeout(() => { wx.navigateBack({ delta: 1 }); }, 1200);
    } catch (err) {
      console.error('发布失败:', err);
      wx.showToast({ title: '发布失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
})
