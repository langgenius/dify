'use client'

import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { useTheme } from 'next-themes'
import { useCallback } from 'react'
import { useLocale, useTranslation } from '#i18n'
import MarketplaceDetailDialogFrame from '../detail-dialog/frame'
import { getTemplateLinkInMarketplace } from '../utils'

const MARKETPLACE_INSTALL_MESSAGE_TYPE = 'dify-marketplace:install-template'

type TemplateDetailDialogProps = {
  open: boolean
  template: MarketplaceTemplate
  onInstall: () => void
  onOpenChange: (open: boolean) => void
}

export default function TemplateDetailDialog({
  open,
  template,
  onInstall,
  onOpenChange,
}: TemplateDetailDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  // resolvedTheme maps the "system" preference to the concrete light/dark
  // value the marketplace page expects.
  const { resolvedTheme } = useTheme()
  const detailLabel = t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })
  const detailURL = getTemplateLinkInMarketplace(template, {
    language: locale,
    source: globalThis.location?.origin,
    theme: resolvedTheme,
    view: 'modal',
  })
  const handleMessage = useCallback(
    (data: unknown) => {
      if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        !('templateId' in data) ||
        data.type !== MARKETPLACE_INSTALL_MESSAGE_TYPE ||
        data.templateId !== template.id
      )
        return

      onInstall()
    },
    [onInstall, template.id],
  )

  return (
    <MarketplaceDetailDialogFrame
      open={open}
      src={detailURL}
      title={`${template.template_name} · ${detailLabel}`}
      onMessage={handleMessage}
      onOpenChange={onOpenChange}
    />
  )
}
