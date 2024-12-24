'use client'
import type { FC } from 'react'
import React from 'react'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import Popover from '@/app/components/base/popover'
import { languages } from '@/i18n/language'

export type ILanguageSelectProps = {
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
              className='w-full py-2 px-3 inline-flex items-center justify-between hover:bg-state-base-hover rounded-lg cursor-pointer'
              onClick={() => onSelect(prompt_name)}
            >
              <span className='text-text-secondary system-sm-medium'>{prompt_name}</span>
              {(currentLanguage === prompt_name) && <RiCheckLine className='size-4 text-text-accent' />}
            </div>
          ))}
        </div>
      }
      btnElement={
        <div className={cn('inline-flex items-center gap-x-[1px]', disabled && 'cursor-not-allowed')}>
          <span className={cn(
            'px-[3px] system-xs-semibold text-components-button-tertiary-text',
            disabled ? 'text-components-button-tertiary-text-disabled' : '',
          )}>
            {currentLanguage}
          </span>
          <RiArrowDownSLine className={cn(
            'size-3.5 text-components-button-tertiary-text',
            disabled ? 'text-components-button-tertiary-text-disabled' : '',
          )} />
        </div>
      }
      btnClassName={() => cn(
        '!border-0 rounded-md !px-1.5 !py-1 !mx-1 !bg-components-button-tertiary-bg !hover:bg-components-button-tertiary-bg',
        disabled ? 'bg-components-button-tertiary-bg-disabled' : '',
      )}
      className='!w-[140px] h-fit !z-20 !translate-x-0 !left-1'
    />
  )
}
export default React.memo(LanguageSelect)
