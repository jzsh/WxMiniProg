// pages/couple_things/couple_things.js
const cloud = require('../../utils/cloud');

// 完整的100件事清单（已补充完整）
const defaultThings = [
  '抓娃娃','一起旅行','穿情侣装','一起去游乐场','看电影',
  '一起做有纪念意义的礼物送给对方','一起做饭','给对方做生日蛋糕','公众场所拥抱','一起去鬼屋',
  '一起去蹦极','一起去见证一个朋友的婚礼','一起喝醉','给对方吹头发','一起给对方挑衣服',
  '一起去寺庙求福','一起回母校拍照','一起挤公交','一起放孔明灯','一起用情侣手机壳',
  '一起玩游戏','一起去看海','为对方唱一首歌','一起看日出','一起住一次帐篷',
  '在对方生病的时候照顾对方','一起穿情侣鞋','一起放风筝','一起九连拍','一起荡秋千',
  '一起过情人节','一起过纪念日','一起去见家长','一起吃宵夜','背我走一段路',
  '给对方惊喜','一起去对方家吃饭','一起去动物园','一起去一次酒吧','一起去做一次热气球',
  '为对方录下想说的话','给对方准备一次浪漫的告白','偷偷为对方买下不舍得买的东西','一起刷碗','一起喝交杯酒',
  '一起存钱','一起看日落','一起给对方敷面膜','一起去许愿池许愿','一起淋一场雨',
  '一起纹情侣纹身','一起睡懒觉','一起熬通宵跨年','一起去逛超市买好吃的','一起去逛街',
  '一起过生日','一起吃火锅','一起打扫卫生','一起坐摩天轮','一起坐过山车',
  '一起在朋友圈秀恩爱','一起追剧','一起包饺子','为对方改掉一个缺点','为对方拒绝一切暧昧',
  '一起堆雪人','一起看恐怖片','一起看烟花','给对方手写一封信','一起种花',
  '为我挡酒','一起买一张刮刮乐','为对方做一件自己很不喜欢的事','在你的父母面前保护我一次','一起去孤儿院',
  '一起去捡落叶','一起手牵手压马路','一起制定家规','给我讲故事','哄我睡觉',
  '陪你做一件你喜欢做的事情','一起打扑克','一起去医院看新生儿','让你体验一次生宝宝的痛','一起去海南的天涯海角',
  '一起去一次图书馆','一起养一只宠物','一起在铁轨上跑步','一起说对方的一个缺点和优点','一起选戒指',
  '一起拍婚纱照','一起结婚','一起骑自行车环游','一起DIY手工制作','一起参加马拉松',
  '一起学一项新技能','一起露营看星星','一起开一场party','一起写交换日记','一起规划未来'
];

Page({
  data: {
    things: [],
    doneSet: {},
    doneCount: 0,
    totalCount: defaultThings.length
  },

  onLoad() {
    this._loadCoupleThingsProgress();
  },

  // 从云数据库加载进度
  _loadCoupleThingsProgress() {
    cloud.getCoupleThingsProgress().then(res => {
      const progressList = res.data || [];
      const doneSet = {};
      let doneCount = 0;
      
      // 将云数据转换为本地格式
      progressList.forEach(item => {
        if (item.completed) {
          doneSet[item.thingIndex] = true;
          doneCount++;
        }
      });
      
      this.setData({ 
        things: defaultThings, 
        doneSet, 
        doneCount,
        progressList // 保存原始数据用于更新
      });
    }).catch(err => {
      console.error('加载进度失败:', err);
      // 加载失败时，默认都是未完成
      this.setData({ 
        things: defaultThings, 
        doneSet: {}, 
        doneCount: 0,
        progressList: []
      });
    });
  },

  toggleItem(e) {
    const index = e.currentTarget.dataset.index;
    const doneSet = { ...this.data.doneSet };
    let doneCount = this.data.doneCount;
    const isCompleted = !doneSet[index];
    const thingText = this.data.things[index];  // 获取事项描述
    
    if (doneSet[index]) {
      delete doneSet[index];
      doneCount--;
    } else {
      doneSet[index] = true;
      doneCount++;
    }
    
    this.setData({ doneSet, doneCount });
    
    // 保存到云数据库（包含事项描述）
    cloud.updateCoupleThingProgress(index, isCompleted, thingText).then(() => {
      console.log('进度已保存到云端');
    }).catch(err => {
      console.error('保存进度失败:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
    
    // 通知便利贴页更新进度
    const pages = getCurrentPages();
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i].route === 'pages/note/note') {
        pages[i].setData({ coupleThingsDone: doneCount });
        break;
      }
    }
  }
})
