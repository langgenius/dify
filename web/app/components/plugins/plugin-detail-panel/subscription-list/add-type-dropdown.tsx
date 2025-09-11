'use client'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RiEqualizer2Line } from '@remixicon/react'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
import { ActionButton } from '@/app/components/base/action-button'

enum SubscriptionAddTypeEnum {
  OAuth = 'oauth',
  APIKey = 'api-key',
  Manual = 'manual',
}

type Props = {
  onSelect: (type: SubscriptionAddTypeEnum) => void
  onClose: () => void
  position?: 'bottom' | 'right'
  className?: string
}

const AddTypeDropdown = ({ onSelect, onClose, position = 'bottom', className }: Props) => {
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

  const onClickClientSettings = () => {
    // todo: show client settings
  }

  const options = [
    {
      key: SubscriptionAddTypeEnum.OAuth,
      title: t('pluginTrigger.subscription.addType.options.oauth.title'),
      extraContent: <ActionButton onClick={onClickClientSettings}><RiEqualizer2Line className='h-4 w-4 text-text-tertiary' /></ActionButton>,
    },
    {
      key: SubscriptionAddTypeEnum.APIKey,
      title: t('pluginTrigger.subscription.addType.options.apiKey.title'),
    },
    {
      key: SubscriptionAddTypeEnum.Manual,
      title: t('pluginTrigger.subscription.addType.options.manual.description'), // 使用 description 作为标题
      tooltip: t('pluginTrigger.subscription.addType.options.manual.tip'),
    },
  ]

  const handleOptionClick = (type: SubscriptionAddTypeEnum) => {
    onSelect(type)
  }

  return (
    <div
      ref={dropdownRef}
      className={cn(
        'absolute z-50 w-full rounded-xl border-[0.5px] border-components-panel-border bg-white/95 p-1 shadow-xl backdrop-blur-sm',
        position === 'bottom'
          ? 'left-1/2 top-full mt-2 -translate-x-1/2'
          : 'right-full top-0 mr-2',
        className,
      )}
    >

      {options.map((option, index) => {
        return (
          <>
            {index === options.length - 1 && <div className="my-1 h-px bg-divider-subtle" />}
            <button
              key={option.key}
              onClick={() => handleOptionClick(option.key)}
              className={cn(
                'flex h-8 w-full items-center gap-1 rounded-lg px-2 py-1 text-left transition-colors hover:bg-state-base-hover',
              )}
            >
              <div className="system-md-regular grow truncate text-text-secondary">
                {option.title}
              </div>
              {
                option.tooltip && (
                  <Tooltip
                    popupContent={option.tooltip}
                    triggerClassName='h-4 w-4 shrink-0'
                  />
                )
              }
              {option.extraContent ? option.extraContent : null}
            </button>
          </>
        )
      })}
    </div>
  )
}

export default AddTypeDropdown
