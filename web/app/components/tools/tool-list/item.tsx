'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { Collection, Tool } from '../types'
import Button from '../../base/button'
import { CollectionType } from '../types'
import AppIcon from '../../base/app-icon'
import I18n from '@/context/i18n'
import Drawer from '@/app/components/base/drawer-plus'

type Props = {
  collection: Collection
  icon: JSX.Element
  payload: Tool
  isInToolsPage: boolean
  added?: boolean
  onAdd?: (payload: Tool) => void
}

const Item: FC<Props> = ({
  collection,
  icon,
  payload,
  isInToolsPage,
  added,
  onAdd,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const isBuiltIn = collection.type === CollectionType.builtIn
  const canShowDetail = !isBuiltIn || (isBuiltIn && isInToolsPage)
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <div
        className={cn(canShowDetail && 'cursor-pointer', 'flex justify-between items-center p-4 rounded-xl border border-gray-200 bg-gray-50 shadow-xs')}
        onClick={() => canShowDetail && setShowDetail(true)}
      >
        <div className='flex'>
          {icon}
          <div className='ml-3'>
            <div className={cn(' truncate', 'text-base font-semibold text-gray-900 truncate')}>{payload.label[locale === 'en' ? 'en_US' : 'zh_Hans']}</div>
            <div className={cn('max-w-[260px] truncate', 'leading-[18px] text-[13px] font-normal text-gray-500 truncate')}>
              {payload.description[locale === 'en' ? 'en_US' : 'zh_Hans']}
            </div>
          </div>
        </div>
        {onAdd && (
          <Button className='flex items-center h-7 !px-3 !text-xs !font-medium !text-gray-700' disabled={added || !collection.is_team_authorization} onClick={() => onAdd(payload)}>{t(`common.operation.${added ? 'added' : 'add'}`)}</Button>
        )}

      </div>
      {showDetail && isBuiltIn && (
        <Drawer
          isShow
          onHide={() => {
            setShowDetail(false)
          }}
          title={(
            <div className='flex'>
              {typeof collection.icon === 'string'
                ? (
                  <div
                    className='w-6 h-6 bg-cover bg-center'
                    style={{
                      backgroundImage: `url(${collection.icon})`,
                    }}
                  ></div>
                )
                : (
                  <AppIcon
                    size='tiny'
                    innerIcon={(collection.icon as any).content}
                    background={(collection.icon as any).content}
                  />
                )}
              <div className='ml-2 leading-6 text-base font-semibold text-gray-900'>{payload.label[locale === 'en' ? 'en_US' : 'zh_Hans']}</div>
            </div>
          )}
          panelClassName='mt-[65px] !w-[480px]'
          maxWidthClassName='!max-w-[480px]'
          height='calc(100vh - 65px)'
          contentClassName='!bg-gray-100'
          headerClassName='!border-b-black/5'
          body={
            <div className='px-6 py-3'>Forms</div>
          }
          isShowMask={true}
          clickOutsideNotOpen={false}
        />)}
    </>

  )
}
export default React.memo(Item)
