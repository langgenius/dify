import type { InputProps } from '@langgenius/dify-ui/input'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SearchInputProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
} & Pick<InputProps, 'aria-label' | 'autoFocus'>

type SearchInputClearButtonProps = {
  ariaLabel: string
  onClick: () => void
}

function SearchInputIcon() {
  return (
    <span
      className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
      aria-hidden="true"
    />
  )
}

function SearchInputClearButton({
  ariaLabel,
  onClick,
}: SearchInputClearButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="group/clear flex size-5 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md border-none bg-transparent p-0 outline-hidden hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
      onClick={onClick}
    >
      <span className="i-ri-close-circle-fill size-4 text-text-quaternary group-hover/clear:text-text-tertiary" aria-hidden="true" />
    </button>
  )
}

export function SearchInput({
  placeholder,
  className,
  value,
  onValueChange,
  autoFocus,
  'aria-label': ariaLabel,
}: SearchInputProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef<boolean>(false)
  const compositionCommitRef = useRef<string | null>(null)
  const [compositionValue, setCompositionValue] = useState('')
  const inputValue = isComposingRef.current ? compositionValue : value

  const handleClear = () => {
    isComposingRef.current = false
    compositionCommitRef.current = null
    setCompositionValue('')
    onValueChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={cn(
      'flex min-h-8 w-full min-w-0 items-center rounded-lg border border-transparent bg-components-input-bg-normal px-2 text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
      'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
      'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      className,
    )}
    >
      <SearchInputIcon />
      <Input
        ref={inputRef}
        type="search"
        name="query"
        aria-label={ariaLabel ?? t('operation.search', { ns: 'common' })}
        className={cn(
          'block h-4.5 w-0 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 py-0 system-sm-regular shadow-none',
          'hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none',
          '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
        )}
        placeholder={placeholder ?? t('operation.search', { ns: 'common' })}
        value={inputValue}
        onValueChange={(nextValue) => {
          if (isComposingRef.current) {
            setCompositionValue(nextValue)
            return
          }
          if (compositionCommitRef.current !== null) {
            if (compositionCommitRef.current !== nextValue) {
              compositionCommitRef.current = null
              onValueChange(nextValue)
              return
            }
            compositionCommitRef.current = null
            return
          }
          onValueChange(nextValue)
        }}
        onCompositionStart={() => {
          isComposingRef.current = true
          compositionCommitRef.current = null
          setCompositionValue(value)
        }}
        onCompositionEnd={(e) => {
          if (!isComposingRef.current)
            return

          isComposingRef.current = false
          setCompositionValue('')
          compositionCommitRef.current = e.currentTarget.value
          onValueChange(e.currentTarget.value)
        }}
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      {inputValue
        ? (
            <SearchInputClearButton
              ariaLabel={t('operation.clear', { ns: 'common' })}
              onClick={handleClear}
            />
          )
        : null}
    </div>
  )
}
