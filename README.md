# 觅光手记

<p align="center">
  <strong>一款面向情侣的微信小程序 — 记录属于你们的每一个瞬间</strong>
</p>

---

## 项目简介

**觅光手记** 是一款基于微信云开发的小程序，为情侣/伴侣提供日记、纪念日、备忘录、小目标等一站式生活记录工具。数据存储在云端，多设备同步，永不丢失。

## 功能概览

| 模块 | 功能说明 |
|------|---------|
| 📔 **日记** | 创建/编辑日记，支持图文、心情、天气、位置标签，封面轮播展示 |
| ❤️ **纪念日** | 添加重要纪念日，自动倒计时提醒 |
| 📝 **便利贴** | 快速便签记录，支持多种颜色 |
| 🎯 **小目标** | 创建个人/情侣目标，追踪完成进度 |
| 📋 **备忘录** | 随手记录待办事项 |
| 🩸 **经期追踪** | 记录经期/排卵期，支持日历拖选范围标记 |
| 💑 **情侣100件事** | 内置100件情侣必做清单，打卡追踪 |
| 🖼️ **相册** | 照片墙浏览，支持网格/列表两种模式 |
| ⭐ **收藏** | 收藏喜欢的日记，随时查看 |
| 🗑️ **回收站** | 误删日记可恢复 |
| 📜 **操作历史** | 完整的操作日志，支持分页浏览 |
| 💾 **数据管理** | 导出/导入/清除数据，支持图片导出 |
| ⚙️ **个人设置** | 修改昵称、头像等资料 |

## 页面结构

```
首页 (Tab)          日记列表 + 轮播图
便利贴 (Tab)        纪念日 | 情侣100件事 | 便利贴 | 快捷入口 | 爱好标签
相册 (Tab)          照片墙（网格/列表切换）
我的 (Tab)          个人中心 + 功能菜单
  ├── 日记详情       查看日记全文、评论、点赞、收藏
  ├── 新建/编辑日记   表单页，支持9图+心情天气位置
  ├── 情侣100件事    100件事打卡列表
  ├── 收藏           收藏的日记列表
  ├── 备忘录         备忘录增删
  ├── 小目标         目标管理+进度条
  ├── 经期追踪       日历+标记
  ├── 回收站         恢复已删除日记/照片
  ├── 操作历史       操作日志（分页+折叠详情）
  ├── 意见反馈       提交反馈
  └── 个人设置       修改资料+数据管理
```

## 技术栈

- **前端**：微信小程序原生框架
- **后端**：微信云开发（云数据库 + 云存储 + 云函数）
- **语言**：JavaScript

## 项目结构

```
├── app.js                  # 小程序入口，初始化云开发+用户身份
├── app.json                # 全局配置（页面路由、TabBar、权限）
├── app.wxss                # 全局样式
├── project.config.json     # 项目配置
├── cloudfunctions/         # 云函数
│   ├── getOpenId/          # 获取用户 OpenID
│   └── getTempURL/         # 获取云存储文件临时链接
├── utils/                  # 工具模块
│   ├── cloud.js            # 云数据库 CRUD 封装（核心）
│   ├── userProfile.js      # 用户资料管理（缓存优先+双写）
│   └── util.js             # 通用工具函数
└── pages/                  # 页面目录
    ├── index/              # 首页
    ├── diary_detail/       # 日记详情
    ├── add_anniversary/    # 新建/编辑日记
    ├── note/               # 便利贴（5合1）
    ├── couple_things/      # 情侣100件事
    ├── album/              # 相册
    ├── mine/               # 我的
    ├── settings/           # 设置
    ├── favorites/          # 收藏
    ├── recycle_bin/        # 回收站
    ├── feedback/           # 意见反馈
    ├── period/             # 经期追踪
    ├── memo/               # 备忘录
    ├── goals/              # 小目标
    └── operation_history/  # 操作历史
```

---

## 部署指南

### 前置条件

1. 注册[微信小程序](https://mp.weixin.qq.com/)账号，获取 **AppID**
2. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
3. 开通**云开发**服务（在开发者工具中点击「云开发」按钮）

### 第一步：克隆项目

```bash
git clone https://github.com/jzsh/MiguangJournal.git
```

### 第二步：导入项目

1. 打开微信开发者工具 → 导入项目
2. 选择项目目录，填入你的 **AppID**
3. 确保勾选「使用云开发」

### 第三步：配置云开发环境

1. 在开发者工具中点击「云开发」→ 创建云环境（如 `cloud1-xxx`）
2. 记下你的**云环境 ID**

3. 修改 `app.js` 中的云环境 ID：

```javascript
// app.js 第22行
wx.cloud.init({
  env: '你的云环境ID',  // 替换为你的云环境ID
  traceUser: true
});
```

### 第四步：创建云数据库集合

在云开发控制台 → 数据库中，逐一创建以下 **13 个集合**：

| 集合名 | 说明 | 权限建议 |
|--------|------|---------|
| `users` | 用户资料 | 仅创建者可读写 |
| `diaries` | 日记 | 仅创建者可读写 |
| `comments` | 评论 | 仅创建者可读写 |
| `sticky_notes` | 便利贴 | 仅创建者可读写 |
| `anniversaries` | 纪念日 | 仅创建者可读写 |
| `quick_entries` | 快捷入口 | 仅创建者可读写 |
| `hobbies` | 爱好标签 | 仅创建者可读写 |
| `couple_things_progress` | 情侣100件事进度 | 仅创建者可读写 |
| `photos` | 照片 | 仅创建者可读写 |
| `memos` | 备忘录 | 仅创建者可读写 |
| `goals` | 小目标 | 仅创建者可读写 |
| `period_records` | 健康记录 | 仅创建者可读写 |
| `favorites` | 收藏 | 仅创建者可读写 |
| `feedback` | 意见反馈 | 仅创建者可读写 |
| `operation_logs` | 操作日志 | 仅创建者可读写 |

> **权限设置方法**：点击集合名 → 「权限设置」→ 选择「仅创建者可读写」

### 第五步：部署云函数

在开发者工具中，依次右键点击 `cloudfunctions/` 下的每个云函数目录：

1. 选择「上传并部署：云端安装依赖」
2. 等待部署完成（约30秒/个）

需要部署的云函数：

| 云函数 | 说明 |
|--------|------|
| `getOpenId` | 获取用户 OpenID |
| `getTempURL` | 获取云存储文件临时链接（绕过客户端权限限制）|

### 第六步：配置云存储权限

在云开发控制台 → 存储 → 权限设置，选择：

```
所有用户可读，仅创建者可读写
```

### 第七步：编译运行

点击开发者工具的「编译」按钮，即可在模拟器中预览。

---

## 数据库结构参考

### users（用户资料）

| 字段 | 类型 | 说明 |
|------|------|------|
| `_id` | String | 用户 OpenID |
| `openid` | String | 用户 OpenID |
| `nickName` | String | 昵称 |
| `avatarUrl` | String | 头像链接 |
| `gender` | Number | 性别（0女/1男/2未知）|
| `phone` | String | 手机号 |
| `age` | Number | 年龄 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

### diaries（日记）

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | String | 标题 |
| `detail` | String | 摘要 |
| `date` | String | 日期（YYYY-MM-DD）|
| `content` | Array | 正文段落列表 |
| `images` | Array | 图片链接列表 |
| `coverImage` | String | 封面图链接 |
| `tag` | String | 标签 |
| `mood` | String | 心情 |
| `weather` | String | 天气 |
| `location` | String | 位置名称 |
| `locationData` | Object | 位置坐标（latitude/longitude/name/address）|
| `likeCount` | Number | 点赞数 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

### memos（备忘录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | String | 标题 |
| `content` | String | 内容 |
| `color` | String | 卡片颜色 |
| `createdAt` | Date | 创建时间 |

### goals（小目标）

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | String | 目标标题 |
| `description` | String | 目标描述 |
| `deadline` | String | 截止日期 |
| `completed` | Boolean | 是否完成 |
| `createdAt` | Date | 创建时间 |
| `updatedAt` | Date | 更新时间 |

### period_records（健康记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | String | 类型（period/intercourse/ovulation）|
| `startDate` | String | 开始日期 |
| `endDate` | String | 结束日期 |
| `createTime` | Date | 创建时间 |

### favorites（收藏）

| 字段 | 类型 | 说明 |
|------|------|------|
| `diaryId` | String | 关联的日记ID |
| `title` | String | 日记标题（冗余） |
| `detail` | String | 日记摘要（冗余） |
| `date` | String | 日记日期 |
| `tag` | String | 标签 |
| `mood` | String | 心情 |
| `coverImage` | String | 封面图 |
| `createdAt` | Date | 收藏时间 |

### operation_logs（操作日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| `userId` | String | 操作者ID |
| `operationType` | String | 操作类型（add/update/delete）|
| `entityType` | String | 实体类型（diary/memo/goal等）|
| `entityId` | String | 实体ID |
| `entityContent` | Object | 操作详情 |
| `operationTime` | Date | 操作时间 |

---

## 常见问题

**Q: 首次打开小程序页面空白？**
A: 检查云环境 ID 是否正确配置在 `app.js` 中，以及云数据库集合是否已创建。

**Q: 上传图片失败？**
A: 确保云存储权限已正确设置，且 `getTempURL` 云函数已部署。

**Q: 数据库操作报 "not exist" 错误？**
A: 说明对应的集合还没创建，请到云开发控制台创建。

**Q: 用户身份获取失败？**
A: 确保 `getOpenId` 云函数已部署，且云环境已开通。

---

## License

MIT
