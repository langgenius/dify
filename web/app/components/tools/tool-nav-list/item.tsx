'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import AppIcon from '../../base/app-icon'
import type { Collection } from '@/app/components/tools/types'
import I18n from '@/context/i18n'
import { getLanguage } from '@/i18n/language'

type Props = {
  isCurrent: boolean
  payload: Collection
  onClick: () => void
}

const Item: FC<Props> = ({
  isCurrent,
  payload,
  onClick,
}) => {
  const { locale } = useContext(I18n)
  const language = getLanguage(locale)
  return (
    <div
      className={cn(isCurrent && 'bg-white shadow-xs rounded-lg', 'mt-1 flex h-9 items-center px-2 space-x-2 cursor-pointer')}
      onClick={() => !isCurrent && onClick()}
    >
      {typeof payload.icon === 'string'
        ? (
          <div
            className='w-6 h-6 bg-cover bg-center rounded-md'
            style={{
              backgroundImage: `url(${payload.icon})`,
            }}
          ></div>
        )
        : (
          <AppIcon
            size='tiny'
            icon={payload.icon.content}
            background={payload.icon.background}
          />
        )}
      <div className={cn(isCurrent && 'text-primary-600 font-semibold', 'leading-5 text-sm font-normal truncate')}>{payload.label[language]}</div>

    </div>
  )
}
export default React.memo(Item)
