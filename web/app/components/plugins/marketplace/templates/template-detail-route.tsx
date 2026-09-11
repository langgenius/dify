'use client'

import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import type { ReactNode } from 'react'
import type { TemplateDetailSelection } from './template-links'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from '@/next/navigation'
import TemplateDetailDialog from './template-detail-dialog'
import { buildTemplateDetailHref, parseTemplateDetailPath } from './template-links'
import { TemplateDetailRouteContext } from './use-optional-template-detail-route'

const catalogLocation = () => `${window.location.pathname}${window.location.search}`

function templateFromSelection(
  selection: TemplateDetailSelection,
  current?: MarketplaceTemplate | null,
): MarketplaceTemplate {
  if (current?.id === selection.id) return current

  return {
    id: selection.id,
    template_name: current?.template_name || selection.publisher,
    overview: '',
    icon: '',
    icon_background: '',
    icon_file_key: '',
    publisher_unique_handle: selection.publisher,
    usage_count: 0,
    categories: [],
  }
}

export function TemplateDetailRouteProvider({
  children,
  initialSelection,
}: {
  children: ReactNode
  initialSelection?: TemplateDetailSelection
}) {
  const router = useRouter()
  const catalogHrefRef = useRef('/templates')
  const [template, setTemplate] = useState<MarketplaceTemplate | null>(() =>
    initialSelection ? templateFromSelection(initialSelection) : null,
  )

  const close = useCallback(() => {
    setTemplate(null)
    if (catalogLocation() !== catalogHrefRef.current)
      window.history.pushState(window.history.state, '', catalogHrefRef.current)
  }, [])

  const open = useCallback((next: MarketplaceTemplate) => {
    if (!parseTemplateDetailPath(window.location.pathname))
      catalogHrefRef.current = catalogLocation() || '/templates'

    setTemplate(next)
    const href = buildTemplateDetailHref(next)
    if (catalogLocation() !== href) window.history.pushState(window.history.state, '', href)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseTemplateDetailPath(window.location.pathname)
      if (!parsed) {
        setTemplate(null)
        return
      }

      setTemplate((current) => templateFromSelection(parsed, current))
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const handleInstall = useCallback(() => {
    if (!template) return
    const templateId = template.id
    setTemplate(null)
    router.push(`/apps?template-id=${encodeURIComponent(templateId)}`)
  }, [router, template])

  const value = useMemo(
    () => ({
      close,
      isOpen: (templateId: string) => template?.id === templateId,
      open,
    }),
    [close, open, template],
  )

  return (
    <TemplateDetailRouteContext.Provider value={value}>
      {children}
      {template && (
        <TemplateDetailDialog
          open
          template={template}
          onInstall={handleInstall}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) close()
          }}
        />
      )}
    </TemplateDetailRouteContext.Provider>
  )
}
