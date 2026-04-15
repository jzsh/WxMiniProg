// 云函数：获取临时文件下载链接（绕过存储权限限制）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { fileList, _action } = event
  
  // 特殊操作：返回用户的 openid
  if (_action === 'getOpenId') {
    const wxContext = cloud.getWXContext()
    return { 
      code: 0, 
      openid: wxContext.OPENID,
      appid: wxContext.APPID
    }
  }

  if (!fileList || fileList.length === 0) {
    return { code: -1, msg: 'fileList 为空' }
  }
  try {
    const result = await cloud.getTempFileURL({ fileList })
    return { code: 0, data: result.fileList }
  } catch (err) {
    return { code: -1, msg: err.message }
  }
}
