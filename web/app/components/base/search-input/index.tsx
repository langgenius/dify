import type { InputProps } from '@langgenius/dify-ui/input'
import type { Ref } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import { useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SearchInputProps = {
  ref?: Ref<HTMLInputElement>
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
} & Pick<InputProps, 'aria-describedby' | 'aria-label' | 'autoFocus' | 'disabled'>

export function SearchInput({
  ref,
  placeholder,
  className,
  value,
  onValueChange,
  autoFocus,
  disabled,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
}: SearchInputProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const isComposingRef = useRef<boolean>(false)
  const compositionCommitRef = useRef<string | null>(null)
  const [compositionValue, setCompositionValue] = useState('')
  const inputValue = isComposingRef.current ? compositionValue : value
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, [])

  const handleClear = () => {
    isComposingRef.current = false
    compositionCommitRef.current = null
    setCompositionValue('')
    onValueChange('')
    inputRef.current?.focus()
  }

  return (
    <div className={cn('relative', className)}>
      <span
        className="pointer-events-none absolute top-1/2 left-2 i-ri-search-line size-4 -translate-y-1/2 text-components-input-text-placeholder"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        name="query"
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel ?? t(($) => $['operation.search'], { ns: 'common' })}
        className={cn(
          'ps-7',
          !!inputValue && 'pe-7',
          '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
        )}
        placeholder={placeholder ?? t(($) => $['operation.search'], { ns: 'common' })}
        value={inputValue}
        disabled={disabled}
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
          if (!isComposingRef.current) return

          isComposingRef.current = false
          setCompositionValue('')
          compositionCommitRef.current = e.currentTarget.value
          onValueChange(e.currentTarget.value)
        }}
        autoComplete="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      {!!inputValue && !disabled && (
        <button
          type="button"
          aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
          className="group/clear absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer touch-manipulation items-center justify-center rounded-md border-none bg-transparent p-0 outline-hidden focus-visible:bg-components-input-bg-hover focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid"
          onClick={handleClear}
        >
          <span
            className="i-ri-close-circle-fill size-4 text-text-quaternary group-hover/clear:text-text-tertiary"
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  )
}
