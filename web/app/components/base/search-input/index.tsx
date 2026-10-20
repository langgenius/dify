import type { InputGroupInputProps } from '@langgenius/dify-ui/input-group'
import type { ComponentProps, Ref } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useTranslation } from 'react-i18next'
import { useSearchInput } from './use-search-input'

type SearchInputClearProps = Pick<
  ComponentProps<'button'>,
  'className' | 'onClick' | 'onMouseDown' | 'tabIndex'
> & {
  'aria-label': string
}

// Same look as dify-ui `ComboboxClear` and `DropdownMenuClear`; change all three together.
// Spread `clearProps` from `useSearchInput` so the button stays out of the tab order and never
// takes focus from the input.
export function SearchInputClear({ className, ...props }: SearchInputClearProps) {
  return (
    <IconButton
      size="sm"
      className={cn('hover:bg-components-input-bg-hover', className)}
      {...props}
    >
      <span className="i-ri-close-line size-4" aria-hidden="true" />
    </IconButton>
  )
}

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
  const { t } = useTranslation(['common'])
  const { inputProps, canClear, clearProps } = useSearchInput({ value, onValueChange, ref })

  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...inputProps}
        name={name}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel ?? t(($) => $['operation.search'], { ns: 'common' })}
        placeholder={placeholder ?? t(($) => $['operation.search'], { ns: 'common' })}
        disabled={disabled}
        autoComplete="off"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- The caller owns initial focus for its search surface.
        autoFocus={autoFocus}
        enterKeyHint="search"
      />
      <InputGroupAddon className="ps-1.75 pe-1.25">
        <span
          className="i-ri-search-line size-4 text-components-input-text-placeholder"
          aria-hidden="true"
        />
      </InputGroupAddon>
      {canClear && !disabled && (
        <InputGroupAddon align="inline-end" className="ps-0.75 pe-1.25">
          <SearchInputClear
            {...clearProps}
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
          />
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
