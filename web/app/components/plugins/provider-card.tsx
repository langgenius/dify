'use client'
import React from 'react'
import type { FC } from 'react'
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
  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const { org, label } = payload
  const { locale } = useI18N()

  return (
    <div className={cn('group relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover:bg-components-panel-on-panel-item-bg rounded-xl shadow-xs', className)}>
      {/* Header */}
      <div className="flex">
        <Icon src={payload.icon} />
        <div className="ml-3 w-0 grow">
          <div className="flex items-center h-5">
            <Title title={getValueFromI18nObject(label)} />
            {/* <RiVerifiedBadgeLine className="shrink-0 ml-0.5 w-4 h-4 text-text-accent" /> */}
          </div>
          <div className='mb-1 flex justify-between items-center h-4'>
            <div className='flex items-center'>
              <div className='text-text-tertiary system-xs-regular'>{org}</div>
              <div className='mx-2 text-text-quaternary system-xs-regular'>·</div>
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
        className='hidden group-hover:flex items-center gap-2 absolute bottom-0 left-0 right-0 p-4 pt-8 rounded-xl bg-gradient-to-tr from-components-panel-on-panel-item-bg to-background-gradient-mask-transparent'
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
          <a href={`${getPluginLinkInMarketplace(payload)}?language=${locale}`} target='_blank' className='flex items-center gap-0.5'>
            {t('plugin.detailPanel.operation.detail')}
            <RiArrowRightUpLine className='w-4 h-4' />
          </a>
        </Button>
      </div>
      {
        isShowInstallFromMarketplace && (
          <InstallFromMarketplace
            manifest={payload as any}
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
