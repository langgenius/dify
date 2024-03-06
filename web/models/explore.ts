import type { AppMode } from '@/types/app'
export type AppBasicInfo = {
  id: string
  mode: AppMode
  icon: string
  icon_background: string
  name: string
  description: string
}

export type AppCategory = 'Writing' | 'Translate' | 'HR' | 'Programming' | 'Assistant'

export type App = {
  app: AppBasicInfo
  app_id: string
  description: string
  copyright: string
  privacy_policy: string | null
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
