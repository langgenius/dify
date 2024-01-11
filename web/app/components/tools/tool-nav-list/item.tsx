'use client'
import type { FC } from 'react'
import React from 'react'
import { useContext } from 'use-context-selector'
import cn from 'classnames'
import AppIcon from '../../base/app-icon'
import type { Collection } from '@/app/components/tools/types'
import I18n from '@/context/i18n'

type Props = {
  isCurrent: boolean
  payload: Collection
  onClick: (payload: Collection) => void
}

const Item: FC<Props> = ({
  isCurrent,
  payload,
  onClick,
}) => {
  const { locale } = useContext(I18n)

  return (
    <div
      className={cn(isCurrent && 'bg-white shadow-xs rounded-lg', 'mt-1 flex h-9 items-center px-2 space-x-2 cursor-pointer')}
      onClick={() => !isCurrent && onClick(payload)}
    >
      {typeof payload.icon === 'string'
        ? (
          <div
            className='w-6 h-6 bg-cover bg-center'
            style={{
              backgroundImage: `url(${payload.icon}?_token=${localStorage.getItem('console_token')})`,
            }}
          ></div>
        )
        : (
          <AppIcon
            size='tiny'
            innerIcon={(payload.icon as any).content}
            background={(payload.icon as any).content}
          />
        )}
      <div className={cn(isCurrent && 'text-primary-600 font-semibold', 'leading-5 text-sm font-normal truncate')}>{payload.label[locale === 'en' ? 'en_US' : 'zh_Hans']}</div>

    </div>
  )
}
export default React.memo(Item)
