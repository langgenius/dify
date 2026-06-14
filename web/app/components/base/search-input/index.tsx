import type { InputProps } from '@langgenius/dify-ui/input'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

type SearchInputProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
} & Pick<InputProps, 'aria-label' | 'autoFocus'>

type SearchInputClearButtonProps = {
  ariaLabel: string
}

type SearchInputController = {
  inputRef: React.RefObject<HTMLInputElement | null>
  inputValue: string
  handleValueChange: (nextValue: string) => void
  handleCompositionStart: () => void
  handleCompositionEnd: (e: React.CompositionEvent<HTMLInputElement>) => void
  clear: () => void
}

type SearchInputRootProps
  = Pick<SearchInputProps, 'value' | 'onValueChange'>
    & {
      children: React.ReactNode
    }

type SearchInputGroupProps = {
  children: React.ReactNode
  className?: string
}

type SearchInputControlProps = Pick<InputProps, 'aria-label' | 'autoFocus' | 'placeholder'>

const SearchInputContext = React.createContext<SearchInputController | null>(null)

function useSearchInputContext() {
  const context = React.use(SearchInputContext)

  if (!context)
    throw new Error('SearchInput parts must be used within SearchInputRoot')

  return context
}

function useSearchInputController({
  value,
  onValueChange,
}: Pick<SearchInputProps, 'value' | 'onValueChange'>): SearchInputController {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isComposingRef = React.useRef<boolean>(false)
  const compositionCommitRef = React.useRef<string | null>(null)
  const [compositionValue, setCompositionValue] = React.useState('')
  const inputValue = isComposingRef.current ? compositionValue : value

  return {
    inputRef,
    inputValue,
    handleValueChange: (nextValue) => {
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
    },
    handleCompositionStart: () => {
      isComposingRef.current = true
      compositionCommitRef.current = null
      setCompositionValue(value)
    },
    handleCompositionEnd: (e) => {
      if (!isComposingRef.current)
        return

      isComposingRef.current = false
      setCompositionValue('')
      compositionCommitRef.current = e.currentTarget.value
      onValueChange(e.currentTarget.value)
    },
    clear: () => {
      isComposingRef.current = false
      compositionCommitRef.current = null
      setCompositionValue('')
      onValueChange('')
      inputRef.current?.focus()
    },
  }
}

function SearchInputRoot({
  value,
  onValueChange,
  children,
}: SearchInputRootProps) {
  const searchInput = useSearchInputController({ value, onValueChange })

  return (
    <SearchInputContext value={searchInput}>
      {children}
    </SearchInputContext>
  )
}

function SearchInputGroup({
  children,
  className,
}: SearchInputGroupProps) {
  return (
    <div className={cn(
      'flex min-h-8 w-full min-w-0 items-center rounded-lg border border-transparent bg-components-input-bg-normal px-2 text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
      'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
      'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
      className,
    )}
    >
      {children}
    </div>
  )
}

function SearchInputIcon() {
  return (
    <span
      className="mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder"
      aria-hidden="true"
    />
  )
}

function SearchInputControl({
  'aria-label': ariaLabel,
  autoFocus,
  placeholder,
}: SearchInputControlProps) {
  const {
    inputRef,
    inputValue,
    handleValueChange,
    handleCompositionStart,
    handleCompositionEnd,
  } = useSearchInputContext()

  return (
    <Input
      ref={inputRef}
      type="search"
      name="query"
      aria-label={ariaLabel}
      className={cn(
        'block h-4.5 w-0 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 py-0 system-sm-regular shadow-none',
        'hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none',
        '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
      )}
      placeholder={placeholder}
      value={inputValue}
      onValueChange={handleValueChange}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      autoComplete="off"
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      enterKeyHint="search"
    />
  )
}

function SearchInputClearButton({
  ariaLabel,
}: SearchInputClearButtonProps) {
  const { inputValue, clear } = useSearchInputContext()

  if (!inputValue)
    return null

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="group/clear flex size-5 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md border-none bg-transparent p-0 outline-hidden hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
      onClick={clear}
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

  return (
    <SearchInputRoot value={value} onValueChange={onValueChange}>
      <SearchInputGroup className={className}>
        <SearchInputIcon />
        <SearchInputControl
          aria-label={ariaLabel ?? t('operation.search', { ns: 'common' })}
          placeholder={placeholder ?? t('operation.search', { ns: 'common' })}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
        <SearchInputClearButton ariaLabel={t('operation.clear', { ns: 'common' })} />
      </SearchInputGroup>
    </SearchInputRoot>
  )
}
