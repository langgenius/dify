'use client'
import type { FC } from 'react'
import React from 'react'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Popover from '@/app/components/base/popover'
import { languages } from '@/i18n/language'

export interface ILanguageSelectProps {
  currentLanguage: string
  onSelect: (language: string) => void
  disabled?: boolean
}

const LanguageSelect: FC<ILanguageSelectProps> = ({
  currentLanguage,
  onSelect,
  disabled,
}) => {
  return (
    <Popover
      manualClose
      trigger='click'
      disabled={disabled}
      popupClassName='z-20'
      htmlContent={
        <div className='w-full p-1'>
          {languages.filter(language => language.supported).map(({ prompt_name }) => (
            <div
              key={prompt_name}
              className='hover:bg-state-base-hover inline-flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2'
              onClick={() => onSelect(prompt_name)}
            >
              <span className='text-text-secondary system-sm-medium'>{prompt_name}</span>
              {(currentLanguage === prompt_name) && <RiCheckLine className='text-text-accent size-4' />}
            </div>
          ))}
        </div>
      }
      btnElement={
        <div className={cn('inline-flex items-center gap-x-[1px]', disabled && 'cursor-not-allowed')}>
          <span className={cn(
            'system-xs-semibold text-components-button-tertiary-text px-[3px]',
            disabled ? 'text-components-button-tertiary-text-disabled' : '',
          )}>
            {currentLanguage}
          </span>
          <RiArrowDownSLine className={cn(
            'text-components-button-tertiary-text size-3.5',
            disabled ? 'text-components-button-tertiary-text-disabled' : '',
          )} />
        </div>
      }
      btnClassName={() => cn(
        '!bg-components-button-tertiary-bg !hover:bg-components-button-tertiary-bg !mx-1 rounded-md !border-0 !px-1.5 !py-1',
        disabled ? 'bg-components-button-tertiary-bg-disabled' : '',
      )}
      className='!left-1 !z-20 h-fit !w-[140px] !translate-x-0'
    />
  )
}
export default React.memo(LanguageSelect)
