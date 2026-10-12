'use client'
import type { FC } from 'react'
import type { Plugin } from './types'
import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useBoolean } from 'ahooks'
import { useTheme } from 'next-themes'
import * as React from 'react'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import usePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-plugin-install-permission'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import { useMarketplaceDetailNavigation } from '@/app/components/plugins/marketplace/use-detail-navigation'
import { getPluginLinkInMarketplace } from '@/app/components/plugins/marketplace/utils'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import Badge from '../base/badge'
import Icon from './card/base/card-icon'
import Description from './card/base/description'
import DownloadCount from './card/base/download-count'

type Props = Readonly<{
  className?: string
  payload: Plugin
}>

const ProviderCardComponent: FC<Props> = ({ className, payload }) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation(['plugin'])
  const { theme } = useTheme()
  const [
    isShowInstallFromMarketplace,
    { setTrue: showInstallFromMarketplace, setFalse: hideInstallFromMarketplace },
  ] = useBoolean(false)
  const { canInstallPlugin } = usePluginInstallPermission()
  const { org, label } = payload
  const pluginLabel = getValueFromI18nObject(label)
  const titleId = useId()
  const locale = useLocale()
  const navigation = useMarketplaceDetailNavigation()

  // Memoize the marketplace link params to prevent unnecessary re-renders
  const marketplaceLinkParams = useMemo(() => ({ language: locale, theme }), [locale, theme])

  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'group relative rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs hover:bg-components-panel-on-panel-item-bg',
        className,
      )}
    >
      {/* Header */}
      <div className="flex">
        <Icon src={payload.icon} />
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <h2
              id={titleId}
              className="truncate system-md-semibold text-text-secondary"
              title={pluginLabel}
            >
              {pluginLabel}
            </h2>
            {/* <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" /> */}
          </div>
          <div className="mb-1 flex h-4 items-center justify-between">
            <div className="flex items-center">
              <div className="system-xs-regular text-text-tertiary">{org}</div>
              <div className="mx-2 system-xs-regular text-text-quaternary">·</div>
              <DownloadCount downloadCount={payload.install_count || 0} />
            </div>
          </div>
        </div>
      </div>
      <Description
        className="mt-3"
        text={getValueFromI18nObject(payload.brief)}
        descriptionLineRows={2}
      ></Description>
      <div className="mt-3 flex space-x-0.5">
        {payload.tags.map((tag) => (
          <Badge key={tag.name} text={tag.name} />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 rounded-xl bg-linear-to-tr from-components-panel-on-panel-item-bg to-background-gradient-mask-transparent p-4 pt-4 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
        {canInstallPlugin && (
          <Button
            aria-label={`${t(($) => $['detailPanel.operation.install'], { ns: 'plugin' })} ${pluginLabel}`}
            className="grow"
            variant="primary"
            onClick={showInstallFromMarketplace}
          >
            {t(($) => $['detailPanel.operation.install'], { ns: 'plugin' })}
          </Button>
        )}
        <a
          aria-label={`${t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })} ${pluginLabel}`}
          href={
            navigation.pluginHref(payload) ??
            getPluginLinkInMarketplace(payload, marketplaceLinkParams)
          }
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: 'secondary' }), 'grow gap-0.5')}
        >
          {t(($) => $['detailPanel.operation.detail'], { ns: 'plugin' })}
          <span className="i-ri-arrow-right-up-line size-4" />
        </a>
      </div>
      {isShowInstallFromMarketplace && (
        <InstallFromMarketplace
          manifest={payload}
          uniqueIdentifier={payload.latest_package_identifier}
          onClose={hideInstallFromMarketplace}
          onSuccess={hideInstallFromMarketplace}
        />
      )}
    </article>
  )
}

// Memoize the component to prevent unnecessary re-renders when props haven't changed
const ProviderCard = React.memo(ProviderCardComponent)

export default ProviderCard
