'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
} from '@remixicon/react'

const i18nPrefix = 'workflow.singleRun'

export type Props = {
  nodeName: string
  onHide: () => void
  children: React.ReactNode
}

const PanelWrap: FC<Props> = ({
  nodeName,
  onHide,
  children,
}) => {
  const { t } = useTranslation()
  return (
    <div className='absolute inset-0 z-10 rounded-2xl bg-background-overlay-alt'>
      <div className='flex h-full flex-col rounded-2xl bg-components-panel-bg'>
        <div className='flex h-8 shrink-0 items-center justify-between pl-4 pr-3 pt-3'>
          <div className='truncate text-base font-semibold text-text-primary'>
            {t(`${i18nPrefix}.testRun`)} {nodeName}
          </div>
          <div className='ml-2 shrink-0 cursor-pointer p-1' onClick={() => {
            onHide()
          }}>
            <RiCloseLine className='h-4 w-4 text-text-tertiary ' />
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
export default React.memo(PanelWrap)
