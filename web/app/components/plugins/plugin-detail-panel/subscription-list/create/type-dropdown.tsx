'use client'
import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RiEqualizer2Line } from '@remixicon/react'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
import { ActionButton } from '@/app/components/base/action-button'
import { SupportedCreationMethods } from '../../../types'
import type { TriggerOAuthConfig } from '@/app/components/workflow/block-selector/types'

type Props = {
  onSelect: (type: SupportedCreationMethods) => void
  onClose: () => void
  position?: 'bottom' | 'right'
  className?: string
  supportedMethods: SupportedCreationMethods[]
  oauthConfig?: TriggerOAuthConfig
}

export const CreateTypeDropdown = ({ onSelect, onClose, position = 'bottom', className, supportedMethods }: Props) => {
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

  const allOptions = [
    {
      key: SupportedCreationMethods.OAUTH,
      title: t('pluginTrigger.subscription.addType.options.oauth.title'),
      extraContent: <ActionButton onClick={onClickClientSettings}><RiEqualizer2Line className='h-4 w-4 text-text-tertiary' /></ActionButton>,
      show: supportedMethods.includes(SupportedCreationMethods.OAUTH),
    },
    {
      key: SupportedCreationMethods.APIKEY,
      title: t('pluginTrigger.subscription.addType.options.apikey.title'),
      show: supportedMethods.includes(SupportedCreationMethods.APIKEY),
    },
    {
      key: SupportedCreationMethods.MANUAL,
      title: t('pluginTrigger.subscription.addType.options.manual.description'), // 使用 description 作为标题
      tooltip: t('pluginTrigger.subscription.addType.options.manual.tip'),
      show: supportedMethods.includes(SupportedCreationMethods.MANUAL),
    },
  ]

  const options = allOptions.filter(option => option.show)

  const handleOptionClick = (type: SupportedCreationMethods) => {
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
