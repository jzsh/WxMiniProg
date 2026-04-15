// 云函数：获取用户的 OpenID
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  
  console.log('[getOpenId] 获取到 OpenID:', wxContext.OPENID)
  
  return {
    code: 0,
    openid: wxContext.OPENID,
    appid: wxContext.APPID
  }
}
