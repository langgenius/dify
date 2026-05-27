import type { InputProps } from '@langgenius/dify-ui/input'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SearchInputProps = Omit<InputProps, 'className' | 'onChange' | 'size' | 'value'> & {
  placeholder?: string
  className?: string
  inputClassName?: string
  value: string
  onChange: (v: string) => void
  white?: boolean
}

function SearchInput({
  placeholder,
  className,
  inputClassName,
  value,
  onChange,
  white,
  ...props
}: SearchInputProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposing = useRef<boolean>(false)
  const [compositionValue, setCompositionValue] = useState<string>('')

  return (
    <div className={cn(
      'relative w-full',
      className,
    )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2 z-1 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
      />
      <Input
        ref={inputRef}
        type="text"
        name="query"
        className={cn(
          'h-8 pl-[26px]',
          value ? 'pr-[26px]' : 'pr-2',
          white && 'border-gray-300! bg-white! shadow-xs placeholder:text-gray-400! hover:border-gray-300! hover:bg-white! focus:border-gray-300! focus:bg-white!',
          inputClassName,
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
        autoComplete="off"
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label={t('operation.clear', { ns: 'common' })}
          className="group/clear absolute top-1/2 right-2 z-1 flex size-4 -translate-y-1/2 cursor-pointer items-center justify-center border-none bg-transparent p-0"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          <span aria-hidden className="i-ri-close-circle-fill size-3.5 text-text-quaternary group-hover/clear:text-text-tertiary" />
        </button>
      )}
    </div>
  )
}

export default SearchInput
