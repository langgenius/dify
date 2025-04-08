'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiAddLine } from '@remixicon/react'
import type { ConfigItemType } from './config-item'
import ConfigItem from './config-item'

import s from './style.module.css'
import { DataSourceType } from './types'
import Button from '@/app/components/base/button'
import { DataSourceProvider } from '@/models/common'
import cn from '@/utils/classnames'

type Props = {
  type: DataSourceType
  provider?: DataSourceProvider
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

  const getProviderName = (): string => {
    if (provider === DataSourceProvider.fireCrawl) return '🔥 Firecrawl'
    if (provider === DataSourceProvider.waterCrawl) return 'WaterCrawl'
    return 'Jina Reader'
  }

  return (
    <div className='mb-2 rounded-xl bg-background-section-burn'>
      <div className='flex items-center px-3 py-[9px]'>
        <div className={cn(s[`${type}-icon`], 'mr-3 h-8 w-8 rounded-lg border border-divider-subtle !bg-background-default')} />
        <div className='grow'>
          <div className='flex h-5 items-center'>
            <div className='text-sm font-medium text-text-primary'>{t(`common.dataSource.${type}.title`)}</div>
            {isWebsite && (
              <div className='ml-1 rounded-md bg-components-badge-white-to-dark px-1.5 text-xs font-medium leading-[18px] text-text-secondary'>
                <span className='text-text-tertiary'>{t('common.dataSource.website.with')}</span> {getProviderName()}
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
                  <Button
                    disabled={readOnly}
                    className='ml-3'
                    onClick={onConfigure}
                  >
                    {t('common.dataSource.configure')}
                  </Button>
                )
                : (
                  <>
                    {isSupportList && <div
                      className={
                        `system-sm-medium flex min-h-7 items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-1 text-components-button-secondary-accent-text
                  ${!readOnly ? 'cursor-pointer' : 'cursor-default opacity-50 grayscale'}`
                      }
                      onClick={onConfigure}
                    >
                      <RiAddLine className='mr-[5px] h-4 w-4 text-components-button-secondary-accent-text' />
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
              `ml-3 flex h-7 items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg
              px-3 text-xs font-medium text-components-button-secondary-accent-text
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
              <div className='ml-3 grow border-t border-t-divider-subtle' />
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
