import type { Locale } from '@/i18n-config'
import type { AppIconType } from '@/types/app'

export type ResponseHolder = {}

export type ConversationItem = {
  id: string
  name: string
  inputs: Record<string, any> | null
  introduction: string
}

export type SiteInfo = {
  title: string
  chat_color_theme?: string
  chat_color_theme_inverted?: boolean
  icon_type?: AppIconType | null
  icon?: string
  icon_background?: string | null
  icon_url?: string | null
  description?: string
  default_language?: Locale
  prompt_public?: boolean
  copyright?: string
  privacy_policy?: string
  custom_disclaimer?: string
  show_workflow_steps?: boolean
  use_icon_as_answer_icon?: boolean
}

export type AppMeta = {
  tool_icons: Record<string, string>
}

export type AppData = {
  app_id: string
  can_replace_logo?: boolean
  custom_config: Record<string, any> | null
  enable_site?: boolean
  end_user_id?: string
  site: SiteInfo
}

export type AppConversationData = {
  data: ConversationItem[]
  has_more: boolean
  limit: number
}
