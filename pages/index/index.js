// index.js
const app = getApp()
const cloud = require('../../utils/cloud');

Page({
  data: {
    swiperList: [],
    demoDiaryList: [
      {
        date: '2026-01-01', title: '春日踏青[示例]', summary: '今天天气真好，和朋友们一起去公园赏花了~',
        tag: '生活', mood: '😊 开心', weather: '☀️ 晴天', location: '📍 城市公园',
        coverImage: 'https://picsum.photos/750/500?random=10',
        content: ['今天终于迎来了久违的好天气，阳光暖暖地洒在身上，特别舒服。', '和朋友们约好了去城市公园赏花。樱花开得正好，粉粉的一片，微风一吹花瓣飘落下来，美极了！', '我们在草坪上铺了野餐垫，带了水果、三明治和奶茶，一边吃一边聊天，好久没有这么放松过了。', '下午还租了自行车绕湖骑行，湖边的柳树刚抽出嫩芽，倒映在水面上特别好看。', '回家的路上买了草莓，一边走一边吃，感觉这就是春天的味道吧~'],
        images: ['https://picsum.photos/750/500?random=10', 'https://picsum.photos/750/500?random=11', 'https://picsum.photos/750/500?random=12']
      }
    ],
    allList: [],
    cloudDiaries: [],
    // 分页相关
    pageNum: 0,
    pageSize: 15,
    hasMore: true,
    loading: false,
    loadMoreStatus: ''  // '', 'loading', 'nomore'
  },

  goToAddAnniversary() {
    wx.navigateTo({ url: '/pages/add_anniversary/add_anniversary' });
  },

  onDiaryTap(e) {
    const index = e.currentTarget.dataset.index;
    const diary = this.data.allList[index];
    if (!diary) return;
    wx.navigateTo({
      url: '/pages/diary_detail/diary_detail',
      success(res) {
        res.eventChannel.emit('diaryData', diary);
      }
    });
  },

  // 更新轮播图（只从已有数据取前5个封面图）
  _updateSwiper() {
    const cloudImages = this.data.cloudDiaries
      .filter(d => d.coverImage)
      .slice(0, 5)
      .map(d => d.coverImage);
    if (cloudImages.length > 0) {
      this.setData({ swiperList: cloudImages });
    } else {
      this.setData({ swiperList: [] });
    }
  },

  // 从云数据库加载日记列表（支持分页）
  _loadCloudDiaries(isRefresh) {
    if (this.data.loading) return Promise.resolve();

    let pageNum;
    if (isRefresh || this.data.pageNum === 0) {
      pageNum = 1; // 首次加载或下拉刷新，从第1页开始
    } else {
      if (!this.data.hasMore) return Promise.resolve();
      pageNum = this.data.pageNum + 1; // 加载下一页
    }

    this.setData({ loading: true });

    return cloud.getDiaryList(this.data.pageSize, pageNum).then(res => {
      const newDiaries = (res.data || []).map(item => {
        // 动态从 detail 截取摘要，不再依赖存储的 summary 字段
        const rawDetail = item.detail || '';
        const dynamicSummary = rawDetail.length > 60 ? rawDetail.substring(0, 60) + '…' : (rawDetail || '');
        return {
          ...item,
          _id: item._id,
          _isPublished: true,
          mood: item.mood || '',
          tag: item.tag || '',
          content: item.content || (item.detail ? item.detail.split('\n') : []),
          summary: dynamicSummary,
          locationData: item.locationData || null
        };
      });

      // 收集所有 cloud:// 图片，批量转为临时 HTTP 链接
      const allImageIds = [];
      newDiaries.forEach(d => {
        if (d.coverImage && d.coverImage.startsWith('cloud://')) allImageIds.push(d.coverImage);
        (d.images || []).forEach(img => { if (img && img.startsWith('cloud://')) allImageIds.push(img); });
      });

      return cloud.getTempFileURLs(allImageIds).then(tempURLs => {
        let urlIndex = 0;
        newDiaries.forEach(d => {
          if (d.coverImage && d.coverImage.startsWith('cloud://')) d.coverImage = tempURLs[urlIndex++];
          d.images = (d.images || []).map(img => (img && img.startsWith('cloud://')) ? tempURLs[urlIndex++] : img);
        });

        // 判断是否还有更多数据
        const hasMore = newDiaries.length >= this.data.pageSize;

        // 如果是刷新，替换；如果是加载更多，追加
        let cloudDiaries;
        if (isRefresh || pageNum === 1) {
          cloudDiaries = newDiaries;
        } else {
          cloudDiaries = [...this.data.cloudDiaries, ...newDiaries];
        }

        this.setData({
          cloudDiaries,
          pageNum,
          hasMore,
          loading: false,
          loadMoreStatus: hasMore ? '' : 'nomore'
        });

        this._buildAllList();
        this._updateSwiper();
      });
    }).catch(err => {
      console.error('加载云数据失败:', err);
      this.setData({ loading: false });
      this._buildAllList();
      throw err;
    });
  },

  // 合并云数据和示例数据（按日期倒序排序）
  _buildAllList() {
    let combined;
    // 如果云数据库已经有日记了，就隐藏 demo 日记
    if (this.data.cloudDiaries.length > 0) {
      combined = [...this.data.cloudDiaries];
    } else {
      const deletedDiaryDates = wx.getStorageSync('deletedDiaryDates') || [];
      const filteredDemoDiaries = this.data.demoDiaryList.filter(diary => {
        const diaryKey = diary.date + '_' + diary.title;
        return !deletedDiaryDates.includes(diaryKey);
      });
      combined = [...this.data.cloudDiaries, ...filteredDemoDiaries];
    }
    combined.sort((a, b) => b.date.localeCompare(a.date));
    combined.forEach(d => {
      d.locationData = d.locationData || null;
    });
    this.setData({ allList: combined });
  },

  onLoad() {
    this._loadCloudDiaries(true); // 首次加载
  },

  onShow() {
    if (wx.getStorageSync('needRefreshHome')) {
      wx.removeStorageSync('needRefreshHome');
      this._loadCloudDiaries(true); // 刷新时重新加载
    }
  },

  // 下拉刷新
  onPullDownRefresh() {
    this._loadCloudDiaries(true).then(() => {
      wx.stopPullDownRefresh();
    }).catch(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 触底加载更多
  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return;
    this.setData({ loadMoreStatus: 'loading' });
    this._loadCloudDiaries(false).catch(() => {});
  }
})
