// pages/album/album.js
const cloud = require('../../utils/cloud');

Page({
  data: {
    photos: [],
    viewMode: 'grid',
    maxCount: 99,
    swiperImages: []
  },

  onLoad() {
    this._loadPhotos();
  },

  onShow() {
    this._loadPhotos();
  },

  // 从云数据库加载相册照片（包含 photos 集合 + diaries 中的图片）
  _loadPhotos() {
    const db = wx.cloud.database();

    // 查询 photos 集合 + 分页查询 diaries 集合（客户端 SDK limit 上限 20）
    const fetchPhotos = db.collection('photos').orderBy('createdAt', 'desc').limit(20).get().catch((err) => {
      console.warn('[album] photos 查询失败:', err);
      return { data: [] };
    });

    // 分页查询 diaries：反复 skip+limit 直到取完
    const fetchAllDiaries = async () => {
      const allData = [];
      const pageSize = 20;
      let page = 0;
      let hasMore = true;
      while (hasMore) {
        const res = await db.collection('diaries')
          .orderBy('createdAt', 'desc')
          .skip(page * pageSize)
          .limit(pageSize)
          .get().catch((err) => {
            console.warn('[album] diaries 第', page, '页查询失败:', err);
            return { data: [] };
          });
        const data = res.data || [];
        allData.push(...data);
        hasMore = data.length >= pageSize;
        page++;
        if (page > 50) break; // 安全上限，防止死循环
      }
      return { data: allData };
    };

    Promise.all([fetchPhotos, fetchAllDiaries()]).then(([photosRes, diariesRes]) => {
      console.log('[album] photos 查到', (photosRes.data || []).length, '条');
      console.log('[album] diaries 查到', (diariesRes.data || []).length, '条');

      const allPhotos = [];

      // 1. 从 photos 集合获取
      ;(photosRes.data || []).forEach(item => {
        allPhotos.push({
          _id: item._id,
          fileID: item.fileID,
          src: item.fileID,
          date: item.date || '',
          source: 'album',
          sourceId: item._id
        });
      });

      // 2. 从 diaries 集合提取图片（封面 + images 数组）
      const seenFileIDs = new Set(allPhotos.map(p => p.fileID));
      let diaryImgCount = 0;
      ;(diariesRes.data || []).forEach(diary => {
        const diaryDate = diary.date || '';
        // 封面图
        if (diary.coverImage && diary.coverImage.startsWith('cloud://') && !seenFileIDs.has(diary.coverImage)) {
          seenFileIDs.add(diary.coverImage);
          allPhotos.push({
            _id: 'diary_cover_' + diary._id,
            fileID: diary.coverImage,
            src: diary.coverImage,
            date: diaryDate,
            source: 'diary',
            sourceId: diary._id,
            diaryTitle: diary.title || ''
          });
          diaryImgCount++;
        }
        // images 数组
        ;(diary.images || []).forEach(img => {
          if (img && img.startsWith('cloud://') && !seenFileIDs.has(img)) {
            seenFileIDs.add(img);
            allPhotos.push({
              _id: 'diary_img_' + diary._id + '_' + img.slice(-10),
              fileID: img,
              src: img,
              date: diaryDate,
              source: 'diary',
              sourceId: diary._id,
              diaryTitle: diary.title || ''
            });
            diaryImgCount++;
          }
        });
      });

      console.log('[album] 从 photos 集合获取:', allPhotos.length - diaryImgCount, '张');
      console.log('[album] 从 diaries 提取:', diaryImgCount, '张');
      console.log('[album] 总计:', allPhotos.length, '张');

      // 按日期倒序排列
      allPhotos.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      // 将 cloud:// 转为临时 HTTP 链接用于显示
      const cloudFiles = allPhotos.map(p => p.fileID).filter(s => s && s.startsWith('cloud://'));
      if (cloudFiles.length > 0) {
        return cloud.getTempFileURLs(cloudFiles).then(tempURLs => {
          const urlMap = {};
          cloudFiles.forEach((f, i) => { urlMap[f] = tempURLs[i]; });
          allPhotos.forEach(p => { if (urlMap[p.src]) p.src = urlMap[p.src]; });
          const swiperImages = allPhotos.slice(0, 5).map(p => p.src);
          this.setData({ photos: allPhotos, swiperImages });
        });
      } else {
        const swiperImages = allPhotos.slice(0, 5).map(p => p.src);
        this.setData({ photos: allPhotos, swiperImages });
      }
    }).catch(err => {
      console.error('加载相册失败:', err);
      const localPhotos = wx.getStorageSync('albumPhotos') || [];
      this.setData({ photos: localPhotos });
    });
  },

  switchMode(e) {
    this.setData({ viewMode: e.currentTarget.dataset.mode });
  },

  // 上传图片到云存储
  async uploadPhotos() {
    const remaining = this.data.maxCount - this.data.photos.length;
    if (remaining <= 0) {
      wx.showToast({ title: '相册已满', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remaining > 9 ? 9 : remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original', 'compressed'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...', mask: true });
        try {
          const filePaths = res.tempFiles.map(f => f.tempFilePath);
          const uploadResults = await cloud.uploadImages(filePaths);
          const db = wx.cloud.database();
          const today = new Date().toLocaleDateString();

          // 每张图片存一条记录
          for (const result of uploadResults) {
            await db.collection('photos').add({
              data: {
                fileID: result.fileID,
                date: today,
                createdAt: db.serverDate()
              }
            });
          }
          wx.showToast({ title: '上传成功', icon: 'success' });
          this._loadPhotos();
        } catch (err) {
          console.error('上传失败:', err);
          wx.showToast({ title: '上传失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  previewImage(e) {
    wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.photos.map(p => p.src) });
  },

  // 删除照片（云存储 + 数据库记录）
  // 注意：来自日记的图片只能从相册移除显示，不能删云文件（日记还在用）
  deletePhoto(e) {
    const index = e.currentTarget.dataset.index;
    const photo = this.data.photos[index];
    if (!photo) return;

    const isFromDiary = photo.source === 'diary';
    const content = isFromDiary
      ? '这张图片来自日记，只能从相册中隐藏，不会删除原图。确定隐藏吗？'
      : '确定要删除这张照片吗？删除后不可恢复。';

    wx.showModal({
      title: isFromDiary ? '隐藏照片' : '确认删除',
      content,
      success: async (res) => {
        if (res.confirm) {
          try {
            if (isFromDiary) {
              // 日记图片：只从本地列表移除，不删云文件和数据库
              const photos = this.data.photos.filter((_, i) => i !== index);
              const swiperImages = photos.slice(0, 5).map(p => p.src);
              this.setData({ photos, swiperImages });
              wx.showToast({ title: '已从相册隐藏', icon: 'none' });
            } else {
              // 相册图片：删除云文件 + 数据库记录
              if (photo.fileID && photo.fileID.startsWith('cloud://')) {
                await cloud.deleteFile(photo.fileID);
              }
              if (photo._id) {
                const db = wx.cloud.database();
                await db.collection('photos').doc(photo._id).remove();
              }
              wx.showToast({ title: '已删除', icon: 'none' });
              this._loadPhotos();
            }
          } catch (err) {
            console.error('删除失败:', err);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  onLongPress(e) {
    this.deletePhoto(e);
  }
})
