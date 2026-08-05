'use client'

import type { MarketplaceTemplate } from '@dify/contracts/marketplace'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { useCallback } from 'react'
import AppIcon from '@/app/components/base/app-icon'
import Partner from '@/app/components/plugins/base/badges/partner'
import { MARKETPLACE_API_PREFIX } from '@/config'
import { useRouter } from '@/next/navigation'
import { formatNumberAbbreviated } from '@/utils/format'
import { getIconFromMarketPlace } from '@/utils/get-icon'
import TemplateDetailDialog from './template-detail-dialog'

type TemplateCardProps = {
  template: MarketplaceTemplate
  className?: string
  partnerText: string
}

const MAX_VISIBLE_PLUGIN_DEPENDENCIES = 7

export default function TemplateCard({ template, className, partnerText }: TemplateCardProps) {
  const router = useRouter()
  const [isDetailOpen, { setTrue: showDetail, setFalse: hideDetail }] = useBoolean(false)
  const publisher =
    template.publisher_handle || template.publisher_unique_handle || template.creator_email || ''
  const visiblePlugins = template.deps_plugins?.slice(0, MAX_VISIBLE_PLUGIN_DEPENDENCIES) ?? []
  const remainingPluginCount = Math.max(
    0,
    (template.deps_plugins?.length ?? 0) - MAX_VISIBLE_PLUGIN_DEPENDENCIES,
  )
  const imageUrl = template.icon_file_key
    ? `${MARKETPLACE_API_PREFIX}/templates/${template.id}/icon`
    : undefined
  const handleOpenChange = (open: boolean) => {
    if (open) showDetail()
    else hideDetail()
  }
  const handleInstall = useCallback(() => {
    hideDetail()
    router.push(`/apps?template-id=${encodeURIComponent(template.id)}`)
  }, [hideDetail, router, template.id])

  return (
    <>
      <article
        className={cn(
          'relative flex h-full flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg pb-3 shadow-xs hover:bg-components-panel-on-panel-item-bg-hover',
          className,
        )}
      >
        <div className="flex shrink-0 items-center gap-3 px-4 pt-4 pb-2">
          <AppIcon
            size="large"
            iconType={imageUrl ? 'image' : 'emoji'}
            icon={imageUrl ? undefined : template.icon || '📄'}
            imageUrl={imageUrl}
            background={template.icon_background}
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
            <div className="flex items-center">
              <button
                type="button"
                onClick={showDetail}
                className="truncate text-left system-md-medium text-text-primary outline-hidden after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-state-accent-solid focus-visible:after:ring-inset"
              >
                {template.template_name}
              </button>
              {template.badges?.includes('partner') && (
                <Partner className="relative z-[1] ml-0.5 size-4 shrink-0" text={partnerText} />
              )}
            </div>
            <div className="flex items-center gap-2 system-xs-regular text-text-tertiary">
              {publisher && <span className="truncate">{publisher}</span>}
              {publisher && <span>·</span>}
              <span>{formatNumberAbbreviated(template.usage_count)}</span>
            </div>
          </div>
        </div>
        <div className="min-h-8 px-4 pt-1 pb-2 system-xs-regular text-text-secondary">
          <p className="line-clamp-2" title={template.overview}>
            {template.overview}
          </p>
        </div>
        <div className="mt-auto flex min-h-7 items-center gap-1 px-4 py-1">
          {visiblePlugins.map((pluginId) => (
            <img
              key={pluginId}
              className="size-6 rounded-md border-[0.5px] border-effects-icon-border object-cover"
              src={getIconFromMarketPlace(pluginId)}
              alt=""
              title={pluginId}
            />
          ))}
          {remainingPluginCount > 0 && (
            <span className="system-xs-regular text-text-tertiary">+{remainingPluginCount}</span>
          )}
        </div>
      </article>
      <TemplateDetailDialog
        open={isDetailOpen}
        template={template}
        onInstall={handleInstall}
        onOpenChange={handleOpenChange}
      />
    </>
  )
}
