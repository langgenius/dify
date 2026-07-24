'use client'

import type { FC, KeyboardEvent, RefObject } from 'react'
import { RiSearchLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import ShortcutsName from '@/app/components/workflow/shortcuts-name'

export type SearchInputProps = {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  onChange: (value: string) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  searchMode: string
  placeholder?: string
}

const SearchInput: FC<SearchInputProps> = ({
  inputRef,
  value,
  onChange,
  onKeyDown,
  searchMode,
  placeholder,
}) => {
  const { t } = useTranslation()

  const getModeLabel = () => {
    if (searchMode === 'scopes')
      return 'SCOPES'
    else if (searchMode === 'commands')
      return 'COMMANDS'
    else
      return searchMode.replace('@', '').toUpperCase()
  }

  return (
    <div className="flex items-center gap-3 border-b border-divider-subtle bg-components-panel-bg-blur px-4 py-3">
      <RiSearchLine className="h-4 w-4 text-text-quaternary" />
      <div className="flex flex-1 items-center gap-2">
        <Input
          ref={inputRef}
          value={value}
          placeholder={placeholder || t('gotoAnything.searchPlaceholder', { ns: 'app' })}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="flex-1 !border-0 !bg-transparent !shadow-none"
          wrapperClassName="flex-1 !border-0 !bg-transparent"
          autoFocus
        />
        {searchMode !== 'general' && (
          <div className="flex items-center gap-1 rounded bg-gray-100 px-2 py-[2px] text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span>{getModeLabel()}</span>
          </div>
        )}
      </div>
      <ShortcutsName keys={['ctrl', 'K']} textColor="secondary" />
    </div>
  )
}

export default SearchInput
