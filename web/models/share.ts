import { Locale } from '@/i18n'

export type ResponseHolder = {}

export type ConversationItem = {
  id: string
  name: string
  inputs: Record<string, any> | null
  introduction: string,
}

export type SiteInfo = {
  title: string
  icon: string
  icon_background: string
  description: string
  default_language: Locale
  prompt_public: boolean
  copyright?: string
  privacy_policy?: string
}