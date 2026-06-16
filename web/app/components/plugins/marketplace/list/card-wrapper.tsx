'use client'
import type { Plugin } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { useBoolean } from 'ahooks'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useMemo } from 'react'
import { useLocale, useTranslation } from '#i18n'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import { useTags } from '@/app/components/plugins/hooks'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { getPluginLinkInMarketplace } from '../utils'

type CardWrapperProps = {
  plugin: Plugin
  showInstallButton?: boolean
}
const CardWrapperComponent = ({
  plugin,
  showInstallButton,
}: CardWrapperProps) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const locale = useLocale()
  const { getTagLabel } = useTags()

  // Memoize marketplace link params to prevent unnecessary re-renders
  const marketplaceLinkParams = useMemo(() => ({
    language: locale,
    theme,
  }), [locale, theme])

  // Memoize tag labels to prevent recreating array on every render
  const tagLabels = useMemo(() =>
    plugin.tags.map(tag => getTagLabel(tag.name)), [plugin.tags, getTagLabel])
  const handleOpenMarketplaceDetail = () => {
    window.open(getPluginLinkInMarketplace(plugin, marketplaceLinkParams), '_blank', 'noopener,noreferrer')
  }

  if (showInstallButton) {
    return (
      <div
        className="group relative cursor-pointer rounded-xl"
      >
        <Card
          key={plugin.name}
          payload={plugin}
          variant="marketplace"
          footer={(
            <CardMoreInfo
              downloadCount={plugin.install_count}
              tags={tagLabels}
              variant="marketplace"
            />
          )}
        />
        <div className="pointer-events-none absolute right-[-0.5px] bottom-[-0.5px] left-[-0.5px] z-10 flex items-center gap-2 rounded-b-xl bg-linear-to-t from-components-panel-on-panel-item-bg-hover from-[60%] to-background-gradient-mask-transparent px-4 pt-8 pb-4 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <Button
            variant="primary"
            className="min-w-0 flex-1 shadow-md"
            onClick={showInstallFromMarketplace}
          >
            {t('detailPanel.operation.install', { ns: 'plugin' })}
          </Button>
          <Button
            className="min-w-0 flex-1 gap-0.5 shadow-xs backdrop-blur-[5px]"
            onClick={handleOpenMarketplaceDetail}
          >
            {t('detailPanel.operation.detail', { ns: 'plugin' })}
            <span aria-hidden className="ml-1 i-ri-arrow-right-up-line size-4" />
          </Button>
        </div>
        {
          isShowInstallFromMarketplace && (
            <InstallFromMarketplace
              manifest={plugin}
              uniqueIdentifier={plugin.latest_package_identifier}
              onClose={hideInstallFromMarketplace}
              onSuccess={hideInstallFromMarketplace}
            />
          )
        }
      </div>
    )
  }

  return (
    <div
      className="group relative rounded-xl"
    >
      <Card
        key={plugin.name}
        payload={plugin}
        variant="marketplace"
        footer={(
          <CardMoreInfo
            downloadCount={plugin.install_count}
            tags={tagLabels}
            variant="marketplace"
          />
        )}
      />
    </div>
  )
}

// Memoize the component to prevent unnecessary re-renders when props haven't changed
const CardWrapper = React.memo(CardWrapperComponent)

export default CardWrapper
