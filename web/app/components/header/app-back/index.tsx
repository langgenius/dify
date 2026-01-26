'use client'

import type { AppDetailResponse } from '@/models/app'
import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type IAppBackProps = {
  curApp: AppDetailResponse
}
export default function AppBack({ curApp }: IAppBackProps) {
  const { t } = useTranslation()

  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={cn(`
        flex h-7 cursor-pointer items-center rounded-[10px]
        pl-2.5 pr-2 font-semibold
        text-[#1C64F2]
        ${curApp && 'hover:bg-[#EBF5FF]'}
      `)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {
        (hovered && curApp)
          ? <span className="i-heroicons-arrow-left-24-solid mr-1 h-[18px] w-[18px]" />
          : <span className="i-heroicons-squares-2-x2-24-solid mr-1 h-[18px] w-[18px]" />
      }
      {t('menus.apps', { ns: 'common' })}
    </div>
  )
}
