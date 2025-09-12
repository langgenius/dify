'use client'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiQuestionLine,
  RiSettings4Line,
} from '@remixicon/react'
import cn from '@/utils/classnames'

type SubscriptionAddType = 'api-key' | 'oauth' | 'manual'

type Props = {
  onSelect: (type: SubscriptionAddType) => void
  onClose: () => void
  position?: 'bottom' | 'right'
}

const AddTypeDropdown = ({ onSelect, onClose, position = 'bottom' }: Props) => {
  const { t } = useTranslation()
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node))
        onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const options = [
    {
      key: 'oauth' as const,
      title: t('pluginTrigger.subscription.addType.options.oauth.title'),
      rightIcon: RiSettings4Line,
      hasRightIcon: true,
    },
    {
      key: 'api-key' as const,
      title: t('pluginTrigger.subscription.addType.options.apiKey.title'),
      hasRightIcon: false,
    },
    {
      key: 'manual' as const,
      title: t('pluginTrigger.subscription.addType.options.manual.description'), // 使用 description 作为标题
      rightIcon: RiQuestionLine,
      hasRightIcon: true,
      tooltip: t('pluginTrigger.subscription.addType.options.manual.tip'),
    },
  ]

  const handleOptionClick = (type: SubscriptionAddType) => {
    onSelect(type)
  }

  return (
    <div
      ref={dropdownRef}
      className={cn(
        'absolute z-50 w-full rounded-xl border-[0.5px] border-components-panel-border bg-white/95 shadow-xl backdrop-blur-sm',
        position === 'bottom'
          ? 'left-1/2 top-full mt-2 -translate-x-1/2'
          : 'right-full top-0 mr-2',
      )}
    >
      {/* Context Menu Content */}
      <div className="flex flex-col">
        {/* First Group - OAuth & API Key */}
        <div className="p-1">
          {options.slice(0, 2).map((option, index) => {
            const RightIconComponent = option.rightIcon
            return (
              <button
                key={option.key}
                onClick={() => handleOptionClick(option.key)}
                className={cn(
                  'flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-state-base-hover',
                )}
              >
                {/* Label */}
                <div className="flex grow items-center px-1 py-0.5">
                  <div className="grow truncate text-[14px] leading-[20px] text-[#354052]">
                    {option.title}
                  </div>
                </div>

                {/* Right Icon */}
                {option.hasRightIcon && RightIconComponent && (
                  <div className="flex items-center justify-center rounded-md p-0.5">
                    <div className="flex h-5 w-5 items-center justify-center">
                      <div className="relative h-4 w-4">
                        <RightIconComponent className="h-4 w-4 text-text-tertiary" />
                      </div>
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Separator */}
        <div className="h-px bg-[rgba(16,24,40,0.04)]" />

        {/* Second Group - Manual */}
        <div className="p-1">
          {options.slice(2).map((option) => {
            const RightIconComponent = option.rightIcon
            return (
              <button
                key={option.key}
                onClick={() => handleOptionClick(option.key)}
                className="flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-[rgba(200,206,218,0.2)]"
                title={option.tooltip}
              >
                {/* Label */}
                <div className="flex grow items-center px-1 py-0.5">
                  <div className="grow truncate text-[14px] leading-[20px] text-[#354052]">
                    {option.title}
                  </div>
                </div>

                {/* Right Icon */}
                {option.hasRightIcon && RightIconComponent && (
                  <div className="relative h-4 w-4 shrink-0">
                    <div className="absolute inset-0 flex items-center justify-center p-0.5">
                      <div className="relative h-4 w-4">
                        <div className="absolute inset-[8.333%]">
                          <RightIconComponent className="h-full w-full text-text-tertiary" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Border overlay */}
      <div className="pointer-events-none absolute inset-0 rounded-xl border-[0.5px] border-[rgba(16,24,40,0.08)]" />
    </div>
  )
}

export default AddTypeDropdown
