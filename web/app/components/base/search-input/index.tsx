import type { InputProps } from '@langgenius/dify-ui/input'
import { cn } from '@langgenius/dify-ui/cn'
import { Input } from '@langgenius/dify-ui/input'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useCompositionInputValue } from './use-composition-input-value'

export type SearchInputProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  className?: string
} & Pick<InputProps, 'aria-label' | 'autoFocus'>

export type SearchInputRootProps = Pick<SearchInputProps, 'value' | 'onValueChange'> & {
  children: React.ReactNode
}

export type SearchInputGroupProps = React.ComponentPropsWithRef<'div'>

export type SearchInputIconProps = React.ComponentPropsWithRef<'span'>

export type SearchInputInputProps
  = Omit<InputProps, 'className' | 'defaultValue' | 'onValueChange' | 'type' | 'value'>
    & {
      className?: string
    }

export type SearchInputClearButtonProps
  = Omit<React.ComponentPropsWithRef<'button'>, 'type'>

type SearchInputContextValue = {
  inputRef: React.RefObject<HTMLInputElement | null>
  inputValue: string
  setInputValue: (nextValue: string) => void
  startComposition: () => void
  endComposition: (nextValue: string) => boolean
  clear: () => void
}

const SearchInputContext = React.createContext<SearchInputContextValue | null>(null)

function assignRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (!ref)
    return

  if (typeof ref === 'function') {
    ref(value)
    return
  }

  ref.current = value
}

function composeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (value: T) => {
    refs.forEach(ref => assignRef(ref, value))
  }
}

function useSearchInputContext() {
  const context = React.use(SearchInputContext)

  if (!context)
    throw new Error('Dify SearchInput: compound parts must be used within <SearchInputRoot>.')

  return context
}

export function SearchInputRoot({
  value,
  onValueChange,
  children,
}: SearchInputRootProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const compositionInput = useCompositionInputValue({ value, onValueChange })

  const contextValue: SearchInputContextValue = {
    inputRef,
    inputValue: compositionInput.value,
    setInputValue: compositionInput.onValueChange,
    startComposition: compositionInput.onCompositionStart,
    endComposition: compositionInput.onCompositionEnd,
    clear: () => {
      compositionInput.resetComposition()
      onValueChange('')
      inputRef.current?.focus()
    },
  }

  return (
    <SearchInputContext value={contextValue}>
      {children}
    </SearchInputContext>
  )
}

export function SearchInputGroup({
  children,
  className,
  ...props
}: SearchInputGroupProps) {
  return (
    <div
      className={cn(
        'flex min-h-8 w-full min-w-0 items-center rounded-lg border border-transparent bg-components-input-bg-normal px-2 text-components-input-text-filled shadow-none outline-hidden transition-[background-color,border-color,box-shadow]',
        'hover:border-components-input-border-hover hover:bg-components-input-bg-hover',
        'focus-within:border-components-input-border-active focus-within:bg-components-input-bg-active focus-within:shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function SearchInputIcon({
  className,
  ...props
}: SearchInputIconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('mr-0.5 i-ri-search-line size-4 shrink-0 text-components-input-text-placeholder', className)}
      {...props}
    />
  )
}

export function SearchInputInput({
  className,
  name = 'query',
  autoComplete = 'off',
  enterKeyHint = 'search',
  onCompositionStart,
  onCompositionEnd,
  ref,
  ...props
}: SearchInputInputProps) {
  const {
    inputRef,
    inputValue,
    setInputValue,
    startComposition,
    endComposition,
  } = useSearchInputContext()

  return (
    <Input
      ref={composeRefs(inputRef, ref)}
      type="search"
      name={name}
      className={cn(
        'block h-4.5 w-0 min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 py-0 system-sm-regular shadow-none',
        'hover:border-transparent hover:bg-transparent focus:border-transparent focus:bg-transparent focus:shadow-none',
        '[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
        className,
      )}
      value={inputValue}
      onValueChange={setInputValue}
      onCompositionStart={(event) => {
        onCompositionStart?.(event)
        startComposition()
      }}
      onCompositionEnd={(event) => {
        onCompositionEnd?.(event)
        const committed = endComposition(event.currentTarget.value)

        if (!committed)
          event.currentTarget.value = inputValue
      }}
      autoComplete={autoComplete}
      enterKeyHint={enterKeyHint}
      {...props}
    />
  )
}

export function SearchInputClearButton({
  children,
  className,
  onClick,
  ...props
}: SearchInputClearButtonProps) {
  const { inputValue, clear } = useSearchInputContext()

  if (!inputValue)
    return null

  return (
    <button
      type="button"
      className={cn(
        'group/clear flex size-5 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-md border-none bg-transparent p-0 outline-hidden hover:bg-components-input-bg-hover focus-visible:bg-components-input-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
        className,
      )}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented)
          clear()
      }}
      {...props}
    >
      {children ?? (
        <span className="i-ri-close-circle-fill size-4 text-text-quaternary group-hover/clear:text-text-tertiary" aria-hidden="true" />
      )}
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
  const searchLabel = t('operation.search', { ns: 'common' })

  return (
    <SearchInputRoot value={value} onValueChange={onValueChange}>
      <SearchInputGroup className={className}>
        <SearchInputIcon />
        <SearchInputInput
          aria-label={ariaLabel ?? searchLabel}
          placeholder={placeholder ?? searchLabel}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
        <SearchInputClearButton aria-label={t('operation.clear', { ns: 'common' })} />
      </SearchInputGroup>
    </SearchInputRoot>
  )
}
