'use client'
import type { Plugin } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from '#i18n'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { useTags } from '@/app/components/plugins/hooks'
import { useOptionalPluginInstallPermission } from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n-config'
import Link from '@/next/link'
import { trackMarketplaceSiteCardClick } from '@/utils/marketplace-site-track'
import MarketplaceDetailDialog from '../detail-dialog'
import { getPluginDetailLinkInMarketplace } from '../utils'

type CardWrapperProps = {
  plugin: Plugin
  showInstallButton?: boolean
  isInstalled?: boolean
  linkToMarketplaceDetail?: boolean
  section?: string
}
const CardWrapperComponent = ({
  plugin,
  showInstallButton,
  isInstalled = false,
  linkToMarketplaceDetail = false,
  section = 'list',
}: CardWrapperProps) => {
  const { t } = useTranslation()
  const locale = useGetLanguage()
  const [
    isShowInstallFromMarketplace,
    { setTrue: showInstallFromMarketplace, setFalse: hideInstallFromMarketplace },
  ] = useBoolean(false)
  const [
    isShowMarketplaceDetail,
    { setTrue: showMarketplaceDetail, setFalse: hideMarketplaceDetail },
  ] = useBoolean(false)
  const { canInstallPlugin } = useOptionalPluginInstallPermission()
  const { getTagLabel } = useTags()
  const pluginLabel = renderI18nObject(plugin.label, locale) || plugin.name

  // Memoize tag labels to prevent recreating array on every render
  const tagLabels = useMemo(
    () => plugin.tags.map((tag) => getTagLabel(tag.name)),
    [plugin.tags, getTagLabel],
  )
  const handleMarketplaceDetailOpenChange = (open: boolean) => {
    if (open) showMarketplaceDetail()
    else hideMarketplaceDetail()
  }
  const showInstallAction = !!showInstallButton && canInstallPlugin
  const cardBody = (
    <Card
      key={plugin.name}
      payload={plugin}
      variant="marketplace"
      footer={
        <CardMoreInfo downloadCount={plugin.install_count} tags={tagLabels} variant="marketplace" />
      }
    />
  )

  if (linkToMarketplaceDetail) {
    const itemId = `${plugin.org}/${plugin.name}`

    return (
      <Link
        href={getPluginDetailLinkInMarketplace(plugin)}
        className="block rounded-xl focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        onClick={() => {
          trackMarketplaceSiteCardClick({
            itemId,
            itemType: 'plugin',
            section,
          })
        }}
      >
        <div className="group relative rounded-xl" data-marketplace-card={plugin.plugin_id}>
          {cardBody}
        </div>
      </Link>
    )
  }

  return (
    <div
      className="group relative cursor-pointer rounded-xl"
      data-marketplace-card={plugin.plugin_id}
    >
      <button
        type="button"
        aria-label={pluginLabel}
        className="absolute inset-0 z-[1] rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={showMarketplaceDetail}
      />
      {cardBody}
      {showInstallAction && (
        <div className="pointer-events-none absolute right-[-0.5px] bottom-[-0.5px] left-[-0.5px] z-10 flex items-center gap-2 rounded-b-xl bg-linear-to-t from-components-panel-on-panel-item-bg-hover from-60% to-background-gradient-mask-transparent px-4 pt-8 pb-4 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            variant={isInstalled ? 'secondary' : 'primary'}
            className="min-w-0 flex-1 shadow-md"
            disabled={isInstalled}
            onClick={(event) => {
              event.stopPropagation()
              if (!isInstalled) showInstallFromMarketplace()
            }}
          >
            {isInstalled
              ? t(($) => $['task.installed'], { ns: 'plugin' })
              : t(($) => $['detailPanel.operation.install'], { ns: 'plugin' })}
          </Button>
          <Button
            className="min-w-0 flex-1 shadow-xs backdrop-blur-[5px]"
            onClick={(event) => {
              event.stopPropagation()
              showMarketplaceDetail()
            }}
          >
            {t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })}
          </Button>
        </div>
      )}
      <MarketplaceDetailDialog
        isInstalled={isInstalled}
        open={isShowMarketplaceDetail}
        plugin={plugin}
        onOpenChange={handleMarketplaceDetailOpenChange}
      />
      {isShowInstallFromMarketplace && (
        <InstallFromMarketplace
          manifest={plugin}
          uniqueIdentifier={plugin.latest_package_identifier}
          onClose={hideInstallFromMarketplace}
          onSuccess={hideInstallFromMarketplace}
        />
      )}
    </div>
  )
}

// Memoize the component to prevent unnecessary re-renders when props haven't changed
const CardWrapper = React.memo(CardWrapperComponent)

export default CardWrapper
