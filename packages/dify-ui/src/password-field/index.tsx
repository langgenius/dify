'use client'

import type { InputGroupProps } from '../input-group'
import { Input as BaseInput } from '@base-ui/react/input'
import * as React from 'react'
import { cn } from '../cn'
import { IconButton } from '../icon-button'
import { InputGroup, InputGroupAddon } from '../input-group'
import { textControlGroupInputClassName } from '../internal/form-control'
import { resolveClassName } from '../internal/resolve-class-name'
import { useMergedRefs } from '../use-merged-refs'

type PasswordFieldContextValue = {
  visible: boolean
  setVisible: React.Dispatch<React.SetStateAction<boolean>>
  disabled: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}

const PasswordFieldContext = React.createContext<PasswordFieldContextValue | null>(null)

function usePasswordFieldContext() {
  const context = React.useContext(PasswordFieldContext)
  if (!context) throw new Error('PasswordField parts must be placed within <PasswordField>.')
  return context
}

type PasswordFieldProps = InputGroupProps & {
  disabled?: boolean
}

function PasswordField({ disabled = false, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const contextValue = React.useMemo(
    () => ({ visible, setVisible, disabled, inputRef }),
    [visible, disabled],
  )

  return (
    <PasswordFieldContext.Provider value={contextValue}>
      <InputGroup {...props} />
    </PasswordFieldContext.Provider>
  )
}

type PasswordFieldInputProps = Omit<
  BaseInput.Props,
  'autoComplete' | 'render' | 'size' | 'type'
> & {
  autoComplete: 'current-password' | 'new-password'
}

function PasswordFieldInput({ className, disabled, ref, ...props }: PasswordFieldInputProps) {
  const { visible, disabled: rootDisabled, inputRef } = usePasswordFieldContext()
  const mergedRef = useMergedRefs(ref, inputRef)

  return (
    <BaseInput
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      {...props}
      ref={mergedRef}
      type={visible ? 'text' : 'password'}
      disabled={rootDisabled || disabled}
      className={(state) =>
        cn(textControlGroupInputClassName, 'px-3', resolveClassName(className, state))
      }
    />
  )
}

type PasswordFieldToggleProps = {
  'aria-label': string
  disabled?: boolean
}

function PasswordFieldToggle({ disabled, ...props }: PasswordFieldToggleProps) {
  const { visible, setVisible, disabled: rootDisabled, inputRef } = usePasswordFieldContext()

  return (
    <InputGroupAddon align="inline-end">
      <IconButton
        {...props}
        aria-pressed={visible}
        disabled={rootDisabled || disabled}
        onMouseDown={(event) => {
          if (event.button === 0) event.preventDefault()
        }}
        onClick={() => {
          const input = inputRef.current
          if (input && input === input.ownerDocument.activeElement) {
            const { selectionStart, selectionEnd, selectionDirection } = input
            // Chromium moves the caret to the start after a pointer press changes the input type.
            setTimeout(() => {
              if (input !== input.ownerDocument.activeElement) return
              input.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined)
            })
          }
          setVisible((current) => !current)
        }}
      >
        <span
          aria-hidden="true"
          className={visible ? 'i-ri-eye-off-line size-4' : 'i-ri-eye-line size-4'}
        />
      </IconButton>
    </InputGroupAddon>
  )
}

export { PasswordField, PasswordFieldInput, PasswordFieldToggle }
export type { PasswordFieldInputProps, PasswordFieldProps, PasswordFieldToggleProps }
