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
import { useGetLanguage } from '@/context/i18n'
import { MARKETPLACE_URL_PREFIX } from '@/config'
import InstallFromMarketplace from '@/app/components/plugins/install-plugin/install-from-marketplace'
import cn from '@/utils/classnames'
import { useBoolean } from 'ahooks'

type Props = {
  className?: string
  payload: Plugin
  onSuccess: () => void
}

const ProviderCard: FC<Props> = ({
  className,
  payload,
  onSuccess,
}) => {
  const { t } = useTranslation()
  const [isShowInstallFromMarketplace, {
    setTrue: showInstallFromMarketplace,
    setFalse: hideInstallFromMarketplace,
  }] = useBoolean(false)
  const language = useGetLanguage()
  const { org, label } = payload

  return (
    <div className={cn('group relative p-4 pb-3 border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg hover-bg-components-panel-on-panel-item-bg rounded-xl shadow-xs', className)}>
      {/* Header */}
      <div className="flex">
        <Icon src={payload.icon} />
        <div className="ml-3 w-0 grow">
          <div className="flex items-center h-5">
            <Title title={label[language]} />
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
      <Description className='mt-3' text={payload.brief[language]} descriptionLineRows={2}></Description>
      <div className='mt-3 flex space-x-0.5'>
        {payload.tags.map(tag => (
          <Badge key={tag.name} text={tag.name} />
        ))}
      </div>
      <div
        className='hidden group-hover:flex items-center gap-2 absolute bottom-0 left-0 right-0 p-4 pt-8 rounded-xl bg-gradient-to-tr from-[#f9fafb] to-[rgba(249,250,251,0)]'
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
          <a href={`${MARKETPLACE_URL_PREFIX}/plugins/${payload.org}/${payload.name}`} target='_blank' className='flex items-center gap-0.5'>
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
            onSuccess={() => {
              onSuccess()
              hideInstallFromMarketplace()
            }}
          />
        )
      }
    </div>
  )
}

export default ProviderCard
