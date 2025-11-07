import posthog from 'posthog-js'
import type { UserProfileResponse } from '@/models/common'

/**
 * 从 URL 中提取 UTM 参数
 */
function getUTMParams(): Record<string, string> {
  const utmParams: Record<string, string> = {}
  const urlParams = new URLSearchParams(window.location.search)

  const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

  utmKeys.forEach((key) => {
    const value = urlParams.get(key)
    if (value)
      utmParams[key] = value
  })

  return utmParams
}

/**
 * 识别用户身份并上报到 PostHog
 * @param userProfile - 完整的用户资料对象
 */
export function identifyUser(userProfile: UserProfileResponse) {
  // 检查 PostHog 是否已加载
  if (!posthog.__loaded)
    return

  // 检查是否有有效的用户 ID
  if (!userProfile?.id)
    return

  try {
    const properties: Record<string, any> = {}

    // 用户基本信息
    if (userProfile.email)
      properties.email = userProfile.email
    if (userProfile.name)
      properties.name = userProfile.name
    if (userProfile.created_at)
      properties.created_at = userProfile.created_at
    if (userProfile.interface_language)
      properties.interface_language = userProfile.interface_language
    if (userProfile.interface_theme)
      properties.interface_theme = userProfile.interface_theme
    if (userProfile.timezone)
      properties.timezone = userProfile.timezone

    // 添加当前 URL 的 UTM 参数（如果有）
    const utmParams = getUTMParams()
    if (Object.keys(utmParams).length > 0) {
      Object.entries(utmParams).forEach(([key, value]) => {
        properties[key] = value
      })
    }

    posthog.identify(userProfile.id, properties)
  }
  catch (error) {
    console.error('[PostHog] identify 失败:', error)
  }
}
