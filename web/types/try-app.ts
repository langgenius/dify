import type { App } from '@/models/explore'

export type TryAppSelection = {
  appId: string
  app: App
}

export type SetTryAppPanel = (showTryAppPanel: boolean, params?: TryAppSelection) => void
