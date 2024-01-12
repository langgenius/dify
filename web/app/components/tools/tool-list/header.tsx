'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import type { Collection } from '../types'
import { CollectionType, LOC } from '../types'
import I18n from '@/context/i18n'

type Props = {
  icon: JSX.Element
  collection: Collection
  loc: LOC
  onShowAuth: () => void
}

const Header: FC<Props> = ({
  icon,
  collection,
  loc,
  onShowAuth,
}) => {
  const { locale } = useContext(I18n)
  const { t } = useTranslation()
  const isInToolsPage = loc === LOC.tools
  const isInDebugPage = !isInToolsPage
  const needAuth = collection?.allow_delete

  // const isBuiltIn = collection.type === CollectionType.builtIn
  const isAuthed = collection.is_team_authorization
  return (
    <div className={cn(isInToolsPage ? 'py-4 px-6' : 'py-[11px] pl-4 pr-3', 'flex justify-between  items-center border-b border-gray-200')}>
      <div className='flex items-center'>
        {icon}
        <div className='ml-3'>
          <div className='flex items-center h-6 space-x-1'>
            <div className={cn(isInDebugPage && 'max-w-[160px] truncate', 'text-base font-semibold text-gray-900')}>{collection.label[locale === 'en' ? 'en_US' : 'zh_Hans']}</div>
            <div className='text-xs font-normal text-gray-500'>·</div>
            <div className='text-xs font-normal text-gray-500'>{t('tools.author')}&nbsp;{collection.author}</div>
          </div>
          {collection.description && (
            <div className={cn(isInDebugPage && 'max-w-[260px] truncate', 'leading-[18px] text-[13px] font-normal text-gray-500')}>
              {collection.description[locale === 'en' ? 'en_US' : 'zh_Hans']}
            </div>
          )}
        </div>
      </div>
      {collection.type === CollectionType.builtIn && needAuth && (
        <div
          className={cn('cursor-pointer', 'flex items-center h-8 border border-gray-200 rounded-lg px-3 space-x-2 shadow-xs')}
          onClick={() => onShowAuth()}
        >
          <div className={cn(isAuthed ? 'border-[#12B76A] bg-[#32D583]' : 'border-gray-400 bg-gray-300', 'rounded h-2 w-2 border')}></div>
          <div className='leading-5 text-sm font-medium text-gray-700'>{t(`tools.auth.${isAuthed ? 'authorized' : 'unauthorized'}`)}</div>
        </div>
      )}
    </div >
  )
}
export default React.memo(Header)
