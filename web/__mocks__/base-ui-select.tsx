import type { ReactNode } from 'react'
import * as React from 'react'

const SelectContext = React.createContext({
  value: undefined as unknown,
  onValueChange: (_value: unknown) => {},
})

type SelectProps = {
  children?: ReactNode
  value?: unknown
  onValueChange?: (value: unknown) => void
}

export const Select = ({
  children,
  value,
  onValueChange,
}: SelectProps) => (
  <SelectContext.Provider value={{ value, onValueChange: onValueChange ?? (() => {}) }}>
    <div data-testid="select-root">{children}</div>
  </SelectContext.Provider>
)

export const SelectTrigger = ({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) => (
  <button type="button" {...props}>
    {children}
  </button>
)

export const SelectValue = ({ placeholder }: { placeholder?: ReactNode }) => <>{placeholder}</>

export const SelectContent = ({ children }: { children?: ReactNode }) => (
  <div data-testid="select-content">{children}</div>
)

export const SelectItem = ({
  children,
  value,
  onClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode, value?: unknown }) => {
  const select = React.useContext(SelectContext)
  return (
    <div
      role="option"
      onClick={(event) => {
        onClick?.(event)
        select.onValueChange(value)
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export const SelectItemText = ({ children }: { children?: ReactNode }) => <>{children}</>
export const SelectItemIndicator = ({ children }: { children?: ReactNode }) => <>{children}</>
export const SelectGroup = ({ children }: { children?: ReactNode }) => <>{children}</>
export const SelectLabel = ({ children }: { children?: ReactNode }) => <>{children}</>
export const SelectSeparator = (props: React.HTMLAttributes<HTMLDivElement>) => <div role="separator" {...props} />
