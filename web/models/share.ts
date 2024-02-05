import type { Locale } from '@/i18n'

export type ResponseHolder = {}

export type ConversationItem = {
  id: string
  name: string
  inputs: Record<string, any> | null
  introduction: string
}

export type SiteInfo = {
  title: string
  icon?: string
  icon_background?: string
  description?: string
  default_language?: Locale
  prompt_public?: boolean
  copyright?: string
  privacy_policy?: string
}

export type AppMeta = {
  tool_icons: Record<string, string>
}

export type AppData = {
  app_id: string
  can_replace_logo?: boolean
  custom_config?: Record<string, any>
  enable_site?: boolean
  end_user_id?: string
  site: SiteInfo
}

export type AppConversationData = {
  data: ConversationItem[]
  has_more: boolean
  limit: number
}
