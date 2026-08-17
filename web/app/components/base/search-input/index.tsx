import type { InputGroupInputProps } from '@langgenius/dify-ui/input-group'
import type { Ref } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type SearchInputProps = {
  ref?: Ref<HTMLInputElement>
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
} & Pick<
  InputGroupInputProps,
  'aria-describedby' | 'aria-label' | 'autoFocus' | 'disabled' | 'name'
>

export function SearchInput({
  ref,
  placeholder,
  className,
  value,
  onValueChange,
  name = 'query',
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
    <InputGroup className={className}>
      <InputGroupInput
        ref={inputRef}
        type="search"
        name={name}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel ?? t(($) => $['operation.search'], { ns: 'common' })}
        className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
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
      <InputGroupAddon className="ps-1.75 pe-1.25">
        <span
          className="i-ri-search-line size-4 text-components-input-text-placeholder"
          aria-hidden="true"
        />
      </InputGroupAddon>
      {!!inputValue && !disabled && (
        <InputGroupAddon align="inline-end" className="ps-0.75 pe-1.25">
          <IconButton
            size="sm"
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
            className="text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset"
            onClick={handleClear}
          >
            <span className="i-ri-close-circle-fill size-4" aria-hidden="true" />
          </IconButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
