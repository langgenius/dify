'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { Collection, Tool } from '../types'
import Button from '../../base/button'
import { CollectionType } from '../types'
import TooltipPlus from '../../base/tooltip-plus'
import I18n from '@/context/i18n'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { getLanguage } from '@/i18n/language'
type Props = {
  collection: Collection
  icon: JSX.Element
  payload: Tool
  isInToolsPage: boolean
  isToolNumMax: boolean
  added?: boolean
  onAdd?: (payload: Tool) => void
}

const Item: FC<Props> = ({
  collection,
  icon,
  payload,
  isInToolsPage,
  isToolNumMax,
  added,
  onAdd,
}) => {
  const { t } = useTranslation()
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)

  const isBuiltIn = collection.type === CollectionType.builtIn
  const isModel = collection.type === CollectionType.model
  const canShowDetail = isInToolsPage
  const [showDetail, setShowDetail] = useState(false)
  const addBtn = <Button className='shrink-0 flex items-center h-7 !px-3 !text-xs !font-medium !text-gray-700' disabled={added || !collection.is_team_authorization} onClick={() => onAdd?.(payload)}>{t(`common.operation.${added ? 'added' : 'add'}`)}</Button>

  return (
    <>
      <div
        className={cn(canShowDetail && 'cursor-pointer', 'flex justify-between items-start p-4 rounded-xl border border-gray-200 bg-gray-50 shadow-xs')}
        onClick={() => canShowDetail && setShowDetail(true)}
      >
        <div className='flex items-start w-full'>
          {icon}
          <div className='ml-3 w-0 grow'>
            <div className={cn('text-base font-semibold text-gray-900 truncate')}>{payload.label[language]}</div>
            <div className={cn('leading-[18px] text-[13px] font-normal text-gray-500')}>
              {payload.description[language]}
            </div>
          </div>
        </div>
        <div className='shrink-0'>
          {!isToolNumMax && onAdd && (
            !collection.is_team_authorization
              ? <TooltipPlus popupContent={t('tools.auth.unauthorized')}>
                {addBtn}
              </TooltipPlus>
              : addBtn
          )}
        </div>
      </div>
      {showDetail && (
        <SettingBuiltInTool
          collection={collection}
          toolName={payload.name}
          readonly
          onHide={() => {
            setShowDetail(false)
          }}
          isBuiltIn={isBuiltIn}
          isModel={isModel}
        />
      )}
    </>

  )
}
export default React.memo(Item)
