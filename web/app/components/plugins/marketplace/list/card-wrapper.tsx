'use client'
import React, { useMemo } from 'react'
import { useTheme } from 'next-themes'
import { RiArrowRightUpLine } from '@remixicon/react'
import { getPluginDetailLinkInMarketplace, getPluginLinkInMarketplace } from '../utils'
import Card from '@/app/components/plugins/card'
import CardMoreInfo from '@/app/components/plugins/card/card-more-info'
import type { Plugin } from '@/app/components/plugins/types'
import Button from '@/app/components/base/button'
import { useMixedTranslation } from '@/app/components/plugins/marketplace/hooks'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useBoolean } from 'ahooks'
import { useI18N } from '@/context/i18n'
import { useTags } from '@/app/components/plugins/hooks'

type CardWrapperProps = {
  plugin: Plugin
  showInstallButton?: boolean
  locale?: string
}
const CardWrapperComponent = ({
  plugin,
  showInstallButton,
  locale,
}: CardWrapperProps) => {
  const { t } = useMixedTranslation(locale)
  const { theme } = useTheme()
  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const { locale: localeFromLocale } = useI18N()
  const { getTagLabel } = useTags(t)

  // Memoize marketplace link params to prevent unnecessary re-renders
  const marketplaceLinkParams = useMemo(() => ({
    language: localeFromLocale,
    theme,
  }), [localeFromLocale, theme])

  // Memoize tag labels to prevent recreating array on every render
  const tagLabels = useMemo(() =>
    plugin.tags.map(tag => getTagLabel(tag.name)),
  [plugin.tags, getTagLabel],
  )

  if (showInstallButton) {
    return (
      <div
        className='group relative cursor-pointer rounded-xl  hover:bg-components-panel-on-panel-item-bg-hover'
      >
        <Card
          key={plugin.name}
          payload={plugin}
          locale={locale}
          footer={
            <CardMoreInfo
              downloadCount={plugin.install_count}
              tags={tagLabels}
            />
          }
        />
        {
          <div className='absolute bottom-0 hidden w-full items-center space-x-2 rounded-b-xl bg-gradient-to-tr from-components-panel-on-panel-item-bg to-background-gradient-mask-transparent px-4 pb-4 pt-4 group-hover:flex'>
            <Button
              variant='primary'
              className='w-[calc(50%-4px)]'
              onClick={showInstallFromMarketplace}
            >
              {t('plugin.detailPanel.operation.install')}
            </Button>
            <a href={getPluginLinkInMarketplace(plugin, marketplaceLinkParams)} target='_blank' className='block w-[calc(50%-4px)] flex-1 shrink-0'>
              <Button
                className='w-full gap-0.5'
              >
                {t('plugin.detailPanel.operation.detail')}
                <RiArrowRightUpLine className='ml-1 h-4 w-4' />
              </Button>
            </a>
          </div>
        }
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
    <a
      className='group relative inline-block cursor-pointer rounded-xl'
      href={getPluginDetailLinkInMarketplace(plugin)}
    >
      <Card
        key={plugin.name}
        payload={plugin}
        locale={locale}
        footer={
          <CardMoreInfo
            downloadCount={plugin.install_count}
            tags={tagLabels}
          />
        }
      />
    </a>
  )
}

// Memoize the component to prevent unnecessary re-renders when props haven't changed
const CardWrapper = React.memo(CardWrapperComponent)

export default CardWrapper
