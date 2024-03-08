'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { Collection } from '../types'
import { CollectionType, LOC } from '../types'
import { Settings01 } from '../../base/icons/src/vender/line/general'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'
type Props = {
  icon: JSX.Element
  collection: Collection
  loc: LOC
  onShowAuth: () => void
  onShowEditCustomCollection: () => void
}

const Header: FC<Props> = ({
  icon,
  collection,
  loc,
  onShowAuth,
  onShowEditCustomCollection,
}) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools
  const isInDebugPage = !isInToolsPage

  const needAuth = collection?.allow_delete || collection?.type === CollectionType.model
  const isAuthed = collection.is_team_authorization
  return (
    <div className={cn(isInToolsPage ? 'py-4 px-6' : 'py-[11px] pl-4 pr-3', 'flex justify-between items-start border-b border-gray-200')}>
      <div className='flex items-start w-full'>
        {icon}
        <div className='ml-3 grow w-0'>
          <div className='flex items-center h-6 space-x-1'>
            <div className={cn(isInDebugPage && 'truncate', 'text-base font-semibold text-gray-900')}>{collection.label[language]}</div>
            <div className='text-xs font-normal text-gray-500'>·</div>
            <div className='text-xs font-normal text-gray-500'>{t('tools.author')}&nbsp;{collection.author}</div>
          </div>
          {collection.description && (
            <div className={cn('leading-[18px] text-[13px] font-normal text-gray-500')}>
              {collection.description[language]}
            </div>
          )}
        </div>
      </div>
      {(collection.type === CollectionType.builtIn || collection.type === CollectionType.model) && needAuth && (
        <div
          className={cn('cursor-pointer', 'ml-1 shrink-0 flex items-center h-8 border border-gray-200 rounded-lg px-3 space-x-2 shadow-xs')}
          onClick={() => {
            if (collection.type === CollectionType.builtIn || collection.type === CollectionType.model)
              onShowAuth()
          }}
        >
          <div className={cn(isAuthed ? 'border-[#12B76A] bg-[#32D583]' : 'border-gray-400 bg-gray-300', 'rounded h-2 w-2 border')}></div>
          <div className='leading-5 text-sm font-medium text-gray-700'>{t(`tools.auth.${isAuthed ? 'authorized' : 'unauthorized'}`)}</div>
        </div>
      )}

      {collection.type === CollectionType.custom && (
        <div
          className={cn('cursor-pointer', 'ml-1 shrink-0 flex items-center h-8 border border-gray-200 rounded-lg px-3 space-x-2 shadow-xs')}
          onClick={() => onShowEditCustomCollection()}
        >
          <Settings01 className='w-4 h-4 text-gray-700' />
          <div className='leading-5 text-sm font-medium text-gray-700'>{t('tools.createTool.editAction')}</div>
        </div>
      )}
    </div >
  )
}
export default React.memo(Header)
