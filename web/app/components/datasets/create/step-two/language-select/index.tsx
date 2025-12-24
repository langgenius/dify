'use client'
import type { FC } from 'react'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import * as React from 'react'
import Popover from '@/app/components/base/popover'
import { languages } from '@/i18n-config/language'
import { cn } from '@/utils/classnames'

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
      trigger="click"
      disabled={disabled}
      popupClassName="z-20"
      htmlContent={(
        <div className="w-full p-1">
          {languages.filter(language => language.supported).map(({ prompt_name }) => (
            <div
              key={prompt_name}
              className="inline-flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 hover:bg-state-base-hover"
              onClick={() => onSelect(prompt_name)}
            >
              <span className="system-sm-medium text-text-secondary">{prompt_name}</span>
              {(currentLanguage === prompt_name) && <RiCheckLine className="size-4 text-text-accent" />}
            </div>
          ))}
        </div>
      )}
      btnElement={(
        <div className={cn('inline-flex items-center gap-x-[1px]', disabled && 'cursor-not-allowed')}>
          <span className={cn(
            'system-xs-semibold px-[3px] text-components-button-tertiary-text',
            disabled ? 'text-components-button-tertiary-text-disabled' : '',
          )}
          >
            {currentLanguage}
          </span>
          <RiArrowDownSLine className={cn(
            'size-3.5 text-components-button-tertiary-text',
            disabled ? 'text-components-button-tertiary-text-disabled' : '',
          )}
          />
        </div>
      )}
      btnClassName={() => cn(
        '!hover:bg-components-button-tertiary-bg !mx-1 rounded-md !border-0 !bg-components-button-tertiary-bg !px-1.5 !py-1',
        disabled ? 'bg-components-button-tertiary-bg-disabled' : '',
      )}
      className="!left-1 !z-20 h-fit !w-[140px] !translate-x-0"
    />
  )
}
export default React.memo(LanguageSelect)
