import type { InputGroupInputProps } from '@langgenius/dify-ui/input-group'
import type { Ref } from 'react'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useTranslation } from 'react-i18next'
import { useSearchInput } from './use-search-input'

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
  const { inputProps, clear } = useSearchInput({ value, onValueChange, ref })

  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...inputProps}
        type="search"
        name={name}
        aria-describedby={ariaDescribedBy}
        aria-label={ariaLabel ?? t(($) => $['operation.search'], { ns: 'common' })}
        className="[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
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
      {!!inputProps.value && !disabled && (
        <InputGroupAddon align="inline-end" className="ps-0.75 pe-1.25">
          <IconButton
            size="sm"
            aria-label={t(($) => $['operation.clear'], { ns: 'common' })}
            className="text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset"
            onClick={clear}
          >
            <span className="i-ri-close-circle-fill size-4" aria-hidden="true" />
          </IconButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
