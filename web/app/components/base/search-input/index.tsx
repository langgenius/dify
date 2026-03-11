import type { FC } from 'react'
import { RiCloseCircleFill, RiSearchLine } from '@remixicon/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type SearchInputProps = {
  placeholder?: string
  className?: string
  value: string
  onChange: (v: string) => void
  white?: boolean
}

const SearchInput: FC<SearchInputProps> = ({
  placeholder,
  className,
  value,
  onChange,
  white,
}) => {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focus, setFocus] = useState<boolean>(false)
  const isComposing = useRef<boolean>(false)
  const [compositionValue, setCompositionValue] = useState<string>('')

  return (
    <div className={cn(
      'group flex h-8 items-center overflow-hidden rounded-lg border-none bg-components-input-bg-normal px-2 hover:bg-components-input-bg-hover',
      focus && '!bg-components-input-bg-active',
      white && '!border-gray-300 !bg-white shadow-xs hover:!border-gray-300 hover:!bg-white',
      className,
    )}
    >
      <div className="pointer-events-none mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center">
        <RiSearchLine className="h-4 w-4 text-components-input-text-placeholder" aria-hidden="true" />
      </div>
      <input
        ref={inputRef}
        type="text"
        name="query"
        className={cn(
          'system-sm-regular caret-#295EFF block h-[18px] grow appearance-none border-0 bg-transparent text-components-input-text-filled outline-none placeholder:text-components-input-text-placeholder',
          white && '!bg-white placeholder:!text-gray-400 hover:!bg-white group-hover:!bg-white',
        )}
        placeholder={placeholder || t('operation.search', { ns: 'common' })!}
        value={isComposing.current ? compositionValue : value}
        onChange={(e) => {
          const newValue = e.target.value
          if (isComposing.current)
            setCompositionValue(newValue)
          else
            onChange(newValue)
        }}
        onCompositionStart={() => {
          isComposing.current = true
          setCompositionValue(value)
        }}
        onCompositionEnd={(e) => {
          isComposing.current = false
          setCompositionValue('')
          onChange(e.currentTarget.value)
        }}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          aria-label={t('operation.clear', { ns: 'common' })}
          className="group/clear flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent p-0"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          <RiCloseCircleFill className="h-4 w-4 text-text-quaternary group-hover/clear:text-text-tertiary" />
        </button>
      )}
    </div>
  )
}

export default SearchInput
