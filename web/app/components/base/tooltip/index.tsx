'use client'
import type { FC } from 'react'
import React from 'react'
import { Tooltip as ReactTooltip } from 'react-tooltip' // fixed version to 5.8.3 https://github.com/ReactTooltip/react-tooltip/issues/972
import classNames from '@/utils/classnames'
import 'react-tooltip/dist/react-tooltip.css'

type TooltipProps = {
  selector: string
  content?: string
  disabled?: boolean
  htmlContent?: React.ReactNode
  className?: string // This should use !impornant to override the default styles eg: '!bg-white'
  position?: 'top' | 'right' | 'bottom' | 'left'
  clickable?: boolean
  children: React.ReactNode
  noArrow?: boolean
}

const Tooltip: FC<TooltipProps> = ({
  selector,
  content,
  disabled,
  position = 'top',
  children,
  htmlContent,
  className,
  clickable,
  noArrow,
}) => {
  return (
    <div className='tooltip-container'>
      {React.cloneElement(children as React.ReactElement, {
        'data-tooltip-id': selector,
      })
      }
      <ReactTooltip
        id={selector}
        content={content}
        className={classNames('!z-[999] !bg-white !text-xs !font-normal !text-gray-700 !shadow-lg !opacity-100', className)}
        place={position}
        clickable={clickable}
        isOpen={disabled ? false : undefined}
        noArrow={noArrow}
      >
        {htmlContent && htmlContent}
      </ReactTooltip>
    </div>
  )
}

export default Tooltip
