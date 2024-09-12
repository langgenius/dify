import type { AppIconType, AppMode } from '@/types/app'
export type AppBasicInfo = {
  id: string
  mode: AppMode
  icon_type: AppIconType | null
  icon: string
  icon_background: string
  icon_url: string
  name: string
  description: string
  use_icon_as_answer_icon: boolean
}

export type AppCategory = 'Writing' | 'Translate' | 'HR' | 'Programming' | 'Assistant'

export type App = {
  app: AppBasicInfo
  app_id: string
  description: string
  copyright: string
  privacy_policy: string | null
  custom_disclaimer: string | null
  category: AppCategory
  position: number
  is_listed: boolean
  install_count: number
  installed: boolean
  editable: boolean
  is_agent: boolean
}

export type InstalledApp = {
  app: AppBasicInfo
  id: string
  uninstallable: boolean
  is_pinned: boolean
}
