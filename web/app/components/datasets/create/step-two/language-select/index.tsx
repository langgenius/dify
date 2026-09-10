'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import * as React from 'react'
import { languages } from '@/i18n-config/language'

export type ILanguageSelectProps = {
  currentLanguage: string
  onSelect: (language: string) => void
  disabled?: boolean
}

const LanguageSelect: FC<ILanguageSelectProps> = ({ currentLanguage, onSelect, disabled }) => {
  const supportedLanguages = languages.filter((language) => language.supported)

  return (
    <Select
      value={currentLanguage}
      onValueChange={(value) => {
        if (value == null) return
        onSelect(value)
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="small"
        aria-label="language"
        className={cn(
          'mx-1 w-auto shrink-0 bg-components-button-tertiary-bg text-components-button-tertiary-text hover:bg-components-button-tertiary-bg',
          'data-disabled:cursor-not-allowed data-disabled:bg-components-button-tertiary-bg-disabled data-disabled:text-components-button-tertiary-text-disabled data-disabled:hover:bg-components-button-tertiary-bg-disabled',
        )}
      >
        <SelectValue placeholder={<span>&nbsp;</span>} />
      </SelectTrigger>
      <SelectContent placement="bottom-start" sideOffset={4} className="w-max">
        {supportedLanguages.map(({ prompt_name }) => (
          <SelectItem key={prompt_name} value={prompt_name}>
            <SelectItemText>{prompt_name}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export default React.memo(LanguageSelect)
