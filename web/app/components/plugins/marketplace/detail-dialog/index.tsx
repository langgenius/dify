'use client'

import type { Plugin } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useTheme } from 'next-themes'
import { useState } from 'react'
import { useLocale, useTranslation } from '#i18n'
import { getPluginLinkInMarketplace } from '../utils'

type MarketplaceDetailDialogProps = {
  open: boolean
  plugin: Plugin
  onOpenChange: (open: boolean) => void
}

function MarketplaceDetailDialog({
  open,
  plugin,
  onOpenChange,
}: MarketplaceDetailDialogProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const { theme } = useTheme()
  const [isLoading, setIsLoading] = useState(true)
  const pluginLabel = plugin.label[locale] ?? plugin.label['en-US'] ?? plugin.name
  const detailLabel = t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })
  const detailURL = getPluginLinkInMarketplace(plugin, {
    language: locale,
    source: globalThis.location?.origin,
    theme,
    view: 'modal',
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen)
      setIsLoading(true)
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="h-[min(800px,calc(100dvh-48px))] max-h-none! w-[min(1200px,calc(100vw-48px))] max-w-none! overflow-hidden! border-0 p-0 shadow-xl"
      >
        <DialogTitle className="sr-only">
          {pluginLabel}
          {' · '}
          {detailLabel}
        </DialogTitle>
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 bg-background-default transition-opacity',
            isLoading ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <div className="flex h-[52px] items-center px-6">
            <div className="h-4 w-40 animate-pulse rounded-md bg-state-base-hover motion-reduce:animate-none" />
          </div>
          <div className="mx-auto flex w-full max-w-[1000px] gap-8 px-12 py-8">
            <div className="flex flex-1 flex-col gap-4">
              <div className="h-16 w-2/3 animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
              <div className="h-4 w-full animate-pulse rounded-md bg-state-base-hover motion-reduce:animate-none" />
              <div className="h-4 w-5/6 animate-pulse rounded-md bg-state-base-hover motion-reduce:animate-none" />
              <div className="mt-8 h-72 w-full animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
            </div>
            <div className="hidden w-60 flex-col gap-4 lg:flex">
              <div className="h-24 animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
              <div className="h-52 animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
            </div>
          </div>
        </div>
        <iframe
          className={cn(
            'size-full border-0 bg-background-default transition-opacity',
            isLoading ? 'opacity-0' : 'opacity-100',
          )}
          onLoad={() => setIsLoading(false)}
          referrerPolicy="strict-origin-when-cross-origin"
          src={detailURL}
          title={`${pluginLabel} · ${detailLabel}`}
        />
        <DialogCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          className="top-5 right-5 size-8 rounded-lg"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-background-default to-transparent"
        />
      </DialogContent>
    </Dialog>
  )
}

export default MarketplaceDetailDialog
