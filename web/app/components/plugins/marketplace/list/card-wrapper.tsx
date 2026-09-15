'use client'
import type { Plugin } from '@/app/components/plugins/types'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useBoolean } from 'ahooks'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useMemo, useSyncExternalStore } from 'react'
import { useLocale, useTranslation } from '#i18n'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { useTags } from '@/app/components/plugins/hooks'
import { useOptionalPluginInstallPermission } from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useGetLanguage } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderI18nObject } from '@/i18n-config'
import Link from '@/next/link'
import { trackMarketplaceSiteCardClick } from '@/utils/marketplace-site-track'
import MarketplaceDetailDialog from '../detail-dialog'
import { getPluginDetailLinkInMarketplace, getPluginLinkInMarketplace } from '../utils'

const subscribeToOrigin = () => () => {}

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
  embedDetails,
}: CardWrapperProps & { embedDetails: boolean }) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const pluginLanguage = useGetLanguage()
  const { resolvedTheme } = useTheme()
  const source = useSyncExternalStore(
    subscribeToOrigin,
    () => window.location.origin,
    () => undefined,
  )
  const [
    isShowInstallFromMarketplace,
    { setTrue: showInstallFromMarketplace, setFalse: hideInstallFromMarketplace },
  ] = useBoolean(false)
  const [isDetailOpen, { setTrue: showDetail, set: setDetailOpen }] = useBoolean(false)
  const { canInstallPlugin } = useOptionalPluginInstallPermission()
  const { getTagLabel } = useTags()
  const pluginLabel = renderI18nObject(plugin.label, pluginLanguage) || plugin.name

  // Memoize tag labels to prevent recreating array on every render
  const tagLabels = useMemo(
    () => plugin.tags.map((tag) => getTagLabel(tag.name)),
    [plugin.tags, getTagLabel],
  )
  // Marketplace detail pages only allow Dify Cloud as a frame ancestor.
  // Self-hosted installations open the full page instead.
  const detailURL = getPluginLinkInMarketplace(plugin, {
    language: locale,
    source,
    theme: resolvedTheme,
  })
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
            itemName: pluginLabel,
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
      {embedDetails ? (
        <button
          type="button"
          aria-label={pluginLabel}
          className="absolute inset-0 z-[1] rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={showDetail}
        />
      ) : (
        <a
          href={detailURL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={pluginLabel}
          className="absolute inset-0 z-[1] rounded-xl outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        />
      )}
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
          {embedDetails ? (
            <Button className="min-w-0 flex-1 shadow-xs backdrop-blur-[5px]" onClick={showDetail}>
              {t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })}
            </Button>
          ) : (
            <a
              href={detailURL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants(), 'min-w-0 flex-1 shadow-xs backdrop-blur-[5px]')}
            >
              {t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })}
              <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
            </a>
          )}
        </div>
      )}
      {embedDetails && (
        <MarketplaceDetailDialog
          isInstalled={isInstalled}
          open={isDetailOpen}
          plugin={plugin}
          onOpenChange={setDetailOpen}
        />
      )}
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

function ConsoleCardWrapper(props: CardWrapperProps) {
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })

  return <CardWrapperComponent {...props} embedDetails={deploymentEdition === 'CLOUD'} />
}

// The standalone marketplace does not have a console system-features endpoint.
const CardWrapper = React.memo((props: CardWrapperProps) =>
  props.linkToMarketplaceDetail ? (
    <CardWrapperComponent {...props} embedDetails={false} />
  ) : (
    <ConsoleCardWrapper {...props} />
  ),
)

export default CardWrapper
