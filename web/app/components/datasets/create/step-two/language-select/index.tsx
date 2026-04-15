'use client'
import type { FC } from 'react'
import * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/app/components/base/ui/select'
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
  const supportedLanguages = languages.filter(language => language.supported)

  return (
    <Select
      value={currentLanguage}
      onValueChange={(value) => {
        if (value == null)
          return
        onSelect(value)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="small"
        aria-label="language"
        className={cn(
          'mx-1 w-auto shrink-0 bg-components-button-tertiary-bg text-components-button-tertiary-text hover:bg-components-button-tertiary-bg',
          disabled && 'cursor-not-allowed bg-components-button-tertiary-bg-disabled text-components-button-tertiary-text-disabled hover:bg-components-button-tertiary-bg-disabled',
        )}
      >
        {currentLanguage || <span>&nbsp;</span>}
      </SelectTrigger>
      <SelectContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName="w-max"
        listClassName="no-scrollbar"
      >
        {supportedLanguages.map(({ prompt_name }) => (
          <SelectItem key={prompt_name} value={prompt_name}>
            {prompt_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export default React.memo(LanguageSelect)
