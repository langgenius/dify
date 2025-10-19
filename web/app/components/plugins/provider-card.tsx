'use client'
import React from 'react'
import type { FC } from 'react'
import { useTheme } from 'next-themes'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine } from '@remixicon/react'
import Badge from '../base/badge'
import type { Plugin } from './types'
import Description from './card/base/description'
import Icon from './card/base/card-icon'
import Title from './card/base/title'
import DownloadCount from './card/base/download-count'
import Button from '@/app/components/base/button'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import cn from '@/utils/classnames'
import { useBoolean } from 'ahooks'
import { getPluginLinkInMarketplace } from '@/app/components/plugins/marketplace/utils'
import { useI18N } from '@/context/i18n'
import { useRenderI18nObject } from '@/hooks/use-i18n'

type Props = {
  className?: string
  payload: Plugin
}

const ProviderCard: FC<Props> = ({
  className,
  payload,
}) => {
  const getValueFromI18nObject = useRenderI18nObject()
  const { t } = useTranslation()
  const { theme } = useTheme()
  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const { org, label } = payload
  const { locale } = useI18N()

  return (
    <div className={cn('group relative rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg p-4 pb-3 shadow-xs hover:bg-components-panel-on-panel-item-bg', className)}>
      {/* Header */}
      <div className="flex">
        <Icon src={payload.icon} />
        <div className="ml-3 w-0 grow">
          <div className="flex h-5 items-center">
            <Title title={getValueFromI18nObject(label)} />
            {/* <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" /> */}
          </div>
          <div className='mb-1 flex h-4 items-center justify-between'>
            <div className='flex items-center'>
              <div className='system-xs-regular text-text-tertiary'>{org}</div>
              <div className='system-xs-regular mx-2 text-text-quaternary'>·</div>
              <DownloadCount downloadCount={payload.install_count || 0} />
            </div>
          </div>
        </div>
      </div>
      <Description className='mt-3' text={getValueFromI18nObject(payload.brief)} descriptionLineRows={2}></Description>
      <div className='mt-3 flex space-x-0.5'>
        {payload.tags.map(tag => (
          <Badge key={tag.name} text={tag.name} />
        ))}
      </div>
      <div
        className='absolute bottom-0 left-0 right-0 hidden items-center gap-2 rounded-xl bg-gradient-to-tr from-components-panel-on-panel-item-bg to-background-gradient-mask-transparent p-4 pt-8 group-hover:flex'
      >
        <Button
          className='grow'
          variant='primary'
          onClick={showInstallFromMarketplace}
        >
          {t('plugin.detailPanel.operation.install')}
        </Button>
        <Button
          className='grow'
          variant='secondary'
        >
          <a href={`${getPluginLinkInMarketplace(payload)}?language=${locale}${theme ? `&theme=${theme}` : ''}`} target='_blank' className='flex items-center gap-0.5'>
            {t('plugin.detailPanel.operation.detail')}
            <RiArrowRightUpLine className='h-4 w-4' />
          </a>
        </Button>
      </div>
      {
        isShowInstallFromMarketplace && (
          <InstallFromMarketplace
            manifest={payload}
            uniqueIdentifier={payload.latest_package_identifier}
            onClose={hideInstallFromMarketplace}
            onSuccess={() => hideInstallFromMarketplace()}
          />
        )
      }
    </div>
  )
}

export default ProviderCard
