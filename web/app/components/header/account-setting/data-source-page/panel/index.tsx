'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { PlusIcon } from '@heroicons/react/24/solid'
import type { ConfigItemType } from './config-item'
import ConfigItem from './config-item'

import s from './style.module.css'
import { DataSourceType } from './types'
import cn from '@/utils/classnames'

type Props = {
  type: DataSourceType
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
    <div className='mb-2 border-[0.5px] border-gray-200 bg-gray-50 rounded-xl'>
      <div className='flex items-center px-3 py-[9px]'>
        <div className={cn(s[`${type}-icon`], 'w-8 h-8 mr-3 border border-gray-100 rounded-lg')} />
        <div className='grow'>
          <div className='flex items-center h-5'>
            <div className='text-sm font-medium text-gray-800'>{t(`common.dataSource.${type}.title`)}</div>
            {isWebsite && (
              <div className='ml-1 leading-[18px] px-1.5 rounded-md bg-white border border-gray-100 text-xs font-medium text-gray-700'>
                <span className='text-gray-500'>{t('common.dataSource.website.with')}</span> 🔥 Firecrawl
              </div>
            )}
          </div>
          {
            !isConfigured && (
              <div className='leading-5 text-xs text-gray-500'>
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
                      `flex items-center ml-3 px-3 h-7 bg-white border border-gray-200
                  rounded-md text-xs font-medium text-gray-700
                  ${!readOnly ? 'cursor-pointer' : 'grayscale opacity-50 cursor-default'}`
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
                        `flex items-center px-3 py-1 min-h-7 bg-white border-[0.5px] border-gray-200 text-xs font-medium text-primary-600 rounded-md
                  ${!readOnly ? 'cursor-pointer' : 'grayscale opacity-50 cursor-default'}`
                      }
                      onClick={onConfigure}
                    >
                      <PlusIcon className='w-[14px] h-[14px] mr-[5px]' />
                      {t('common.dataSource.notion.addWorkspace')}
                    </div>}
                  </>
                )
            }
          </>
        )}

        {isWebsite && !isConfigured && (
          <div
            className={
              `flex items-center ml-3 px-3 h-7 bg-white border border-gray-200
              rounded-md text-xs font-medium text-gray-700
              ${!readOnly ? 'cursor-pointer' : 'grayscale opacity-50 cursor-default'}`
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
            <div className='flex items-center px-3 h-[18px]'>
              <div className='text-xs font-medium text-gray-500'>
                {isNotion ? t('common.dataSource.notion.connectedWorkspace') : t('common.dataSource.website.configuredCrawlers')}
              </div>
              <div className='grow ml-3 border-t border-t-gray-100' />
            </div>
            <div className='px-3 pt-2 pb-3'>
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
