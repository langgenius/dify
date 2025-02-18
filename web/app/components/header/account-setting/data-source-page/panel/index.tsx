'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import type { ConfigItemType } from './config-item'
import ConfigItem from './config-item'

import s from './style.module.css'
import { DataSourceType } from './types'
import { DataSourceProvider } from '@/models/common'
import cn from '@/utils/classnames'

type Props = {
  type: DataSourceType
  provider: DataSourceProvider
  isConfigured: boolean
  onConfigure: () => void
  readOnly: boolean
  isSupportList?: boolean
  configuredList: ConfigItemType[]
  onRemove: () => void
  notionActions?: {
    onChangeAuthorizedPage: () => void
  }
}

const Panel: FC<Props> = ({
  type,
  provider,
  isConfigured,
  onConfigure,
  readOnly,
  configuredList,
  isSupportList,
  onRemove,
  notionActions,
}) => {
  const { t } = useTranslation()
  const isNotion = type === DataSourceType.notion
  const isWebsite = type === DataSourceType.website

  return (
    <div className='bg-background-section-burn mb-2 rounded-xl'>
      <div className='flex items-center px-3 py-[9px]'>
        <div className={cn(s[`${type}-icon`], 'border-divider-subtle bg-background-default mr-3 h-8 w-8 rounded-lg border')} />
        <div className='grow'>
          <div className='flex h-5 items-center'>
            <div className='text-text-primary text-sm font-medium'>{t(`common.dataSource.${type}.title`)}</div>
            {isWebsite && (
              <div className='ml-1 rounded-md border border-gray-100 bg-white px-1.5 text-xs font-medium leading-[18px] text-gray-700'>
                <span className='text-gray-500'>{t('common.dataSource.website.with')}</span> { provider === DataSourceProvider.fireCrawl ? '🔥 Firecrawl' : 'Jina Reader'}
              </div>
            )}
          </div>
          {
            !isConfigured && (
              <div className='system-xs-medium text-text-tertiary'>
                {t(`common.dataSource.${type}.description`)}
              </div>
            )
          }
        </div>
        {isNotion && (
          <>
            {
              isConfigured
                ? (
                  <div
                    className={
                      `ml-3 flex h-7 items-center rounded-md border border-gray-200 bg-white
                  px-3 text-xs font-medium text-gray-700
                  ${!readOnly ? 'cursor-pointer' : 'cursor-default opacity-50 grayscale'}`
                    }
                    onClick={onConfigure}
                  >
                    {t('common.dataSource.configure')}
                  </div>
                )
                : (
                  <>
                    {isSupportList && <div
                      className={
                        `bg-components-button-secondary-bg border-components-button-secondary-border system-sm-medium text-components-button-secondary-accent-text flex min-h-7 items-center rounded-md border-[0.5px] px-3 py-1
                  ${!readOnly ? 'cursor-pointer' : 'cursor-default opacity-50 grayscale'}`
                      }
                      onClick={onConfigure}
                    >
                      <RiAddLine className='text-components-button-secondary-accent-text mr-[5px] h-4 w-4' />
                      {t('common.dataSource.connect')}
                    </div>}
                  </>
                )
            }
          </>
        )}

        {isWebsite && !isConfigured && (
          <div
            className={
              `bg-components-button-secondary-bg border-components-button-secondary-border text-components-button-secondary-accent-text ml-3 flex h-7 items-center rounded-md
              border-[0.5px] px-3 text-xs font-medium
              ${!readOnly ? 'cursor-pointer' : 'cursor-default opacity-50 grayscale'}`
            }
            onClick={!readOnly ? onConfigure : undefined}
          >
            {t('common.dataSource.configure')}
          </div>
        )}

      </div>
      {
        isConfigured && (
          <>
            <div className='flex h-[18px] items-center px-3'>
              <div className='system-xs-medium text-text-tertiary'>
                {isNotion ? t('common.dataSource.notion.connectedWorkspace') : t('common.dataSource.website.configuredCrawlers')}
              </div>
              <div className='border-t-divider-subtle ml-3 grow border-t' />
            </div>
            <div className='px-3 pb-3 pt-2'>
              {
                configuredList.map(item => (
                  <ConfigItem
                    key={item.id}
                    type={type}
                    payload={item}
                    onRemove={onRemove}
                    notionActions={notionActions}
                    readOnly={readOnly}
                  />
                ))
              }
            </div>
          </>
        )
      }
    </div>
  )
}
export default React.memo(Panel)
