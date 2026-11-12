'use client'

import type { InputGroupProps } from '../input-group'
import { Input as BaseInput } from '@base-ui/react/input'
import * as React from 'react'
import { cn } from '../cn'
import { IconButton } from '../icon-button'
import { InputGroup, InputGroupAddon } from '../input-group'
import { textControlGroupInputClassName } from '../internal/form-control'
import { resolveClassName } from '../internal/resolve-class-name'

type PasswordFieldContextValue = {
  visible: boolean
  setVisible: React.Dispatch<React.SetStateAction<boolean>>
  disabled: boolean
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
  const contextValue = React.useMemo(() => ({ visible, setVisible, disabled }), [visible, disabled])

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

function PasswordFieldInput({ className, disabled, ...props }: PasswordFieldInputProps) {
  const { visible, disabled: rootDisabled } = usePasswordFieldContext()

  return (
    <BaseInput
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      {...props}
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
  const { visible, setVisible, disabled: rootDisabled } = usePasswordFieldContext()

  return (
    <InputGroupAddon align="inline-end">
      <IconButton
        {...props}
        aria-pressed={visible}
        disabled={rootDisabled || disabled}
        onMouseDown={(event) => {
          if (event.button === 0) event.preventDefault()
        }}
        onClick={() => setVisible((current) => !current)}
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
