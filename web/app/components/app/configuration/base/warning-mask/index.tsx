'use client'
import type { FC } from 'react'
import * as React from 'react'

import s from './style.module.css'

export type IWarningMaskProps = {
  title: string
  description: string
  footer: React.ReactNode
}

const warningIcon = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.99996 13.3334V10.0001M9.99996 6.66675H10.0083M18.3333 10.0001C18.3333 14.6025 14.6023 18.3334 9.99996 18.3334C5.39759 18.3334 1.66663 14.6025 1.66663 10.0001C1.66663 5.39771 5.39759 1.66675 9.99996 1.66675C14.6023 1.66675 18.3333 5.39771 18.3333 10.0001Z" stroke="#F79009" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const WarningMask: FC<IWarningMaskProps> = ({
  title,
  description,
  footer,
}) => {
  return (
    <div className={`${s.mask} absolute inset-0 z-10 bg-components-panel-bg-blur pt-16`}>
      <div className="mx-auto px-10">
        <div className={`${s.icon} flex h-11 w-11 items-center justify-center rounded-xl bg-components-panel-bg`}>{warningIcon}</div>
        <div className="mt-4 text-[24px] font-semibold leading-normal text-text-primary">
          {title}
        </div>
        <div className="mt-3 text-base text-text-secondary">
          {description}
        </div>
        <div className="mt-6">
          {footer}
        </div>
      </div>

    </div>
  )
}
export default React.memo(WarningMask)
