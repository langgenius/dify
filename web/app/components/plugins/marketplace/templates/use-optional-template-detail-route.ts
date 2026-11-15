'use client'

import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { createContext, useContext } from 'react'

export type TemplateDetailRouteValue = {
  close: () => void
  isOpen: (templateId: string) => boolean
  open: (template: MarketplaceTemplate) => void
}

export const TemplateDetailRouteContext = createContext<TemplateDetailRouteValue | null>(null)

export function useOptionalTemplateDetailRoute() {
  return useContext(TemplateDetailRouteContext)
}
