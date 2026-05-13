import type { ReactNode } from 'react'
import * as React from 'react'

const DropdownMenuContext = React.createContext({
  open: false,
  onOpenChange: (_open: boolean) => {},
})

type DropdownMenuProps = {
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type DropdownMenuTriggerProps = React.HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  nativeButton?: boolean
  render?: React.ReactElement
}

type DropdownMenuContentProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
  placement?: string
  sideOffset?: number
  alignOffset?: number
  popupClassName?: string
}

export const DropdownMenu = ({
  children,
  open,
  onOpenChange,
}: DropdownMenuProps) => {
  const [localOpen, setLocalOpen] = React.useState(false)
  const resolvedOpen = open ?? localOpen
  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setLocalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  return (
    <DropdownMenuContext.Provider value={{ open: resolvedOpen, onOpenChange: handleOpenChange }}>
      <div data-testid="dropdown-menu" data-open={String(resolvedOpen)}>
        {children}
      </div>
    </DropdownMenuContext.Provider>
  )
}

export const DropdownMenuTrigger = ({
  children,
  render,
  nativeButton: _nativeButton,
  onClick,
  ...props
}: DropdownMenuTriggerProps) => {
  const { open, onOpenChange } = React.useContext(DropdownMenuContext)
  const node = render ?? children
  const isNativeButton = React.isValidElement(node) && node.type === 'button'
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    onClick?.(event)
    if (!event.defaultPrevented)
      onOpenChange(!open)
  }

  if (React.isValidElement(node)) {
    const triggerElement = node as React.ReactElement<Record<string, unknown>>
    const childProps = (triggerElement.props ?? {}) as React.HTMLAttributes<HTMLElement> & { 'data-testid'?: string }
    const triggerProps = props as React.HTMLAttributes<HTMLElement> & { 'data-testid'?: string }
    const role = childProps.role ?? triggerProps.role ?? (!isNativeButton && (childProps['aria-label'] || triggerProps['aria-label']) ? 'button' : undefined)
    return React.cloneElement(triggerElement, {
      ...props,
      ...childProps,
      'data-testid': childProps['data-testid'] ?? triggerProps['data-testid'] ?? 'dropdown-menu-trigger',
      role,
      'tabIndex': childProps.tabIndex ?? triggerProps.tabIndex ?? (role === 'button' ? 0 : undefined),
      'onClick': (event: React.MouseEvent<HTMLElement>) => {
        childProps.onClick?.(event)
        handleClick(event)
      },
    }, render ? (children ?? childProps.children) : childProps.children)
  }

  return (
    <div data-testid="dropdown-menu-trigger" role="button" tabIndex={0} onClick={handleClick} {...props}>
      {node}
    </div>
  )
}

export const DropdownMenuContent = ({
  children,
  className,
  popupClassName,
  placement,
  sideOffset,
  alignOffset,
  ...props
}: DropdownMenuContentProps) => {
  const { open } = React.useContext(DropdownMenuContext)
  if (!open)
    return null

  return (
    <div
      data-testid="dropdown-menu-content"
      data-placement={placement}
      data-side-offset={sideOffset}
      data-align-offset={alignOffset}
      className={className || popupClassName}
      {...props}
    >
      {children}
    </div>
  )
}

export const DropdownMenuItem = ({
  children,
  onClick,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => (
  <div role="menuitem" onClick={onClick} {...props}>
    {children}
  </div>
)

export const DropdownMenuRadioGroup = ({
  children,
  onValueChange,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode, value?: unknown, onValueChange?: (value: unknown) => void }) => (
  <div
    role="radiogroup"
    {...props}
    data-on-value-change={onValueChange ? 'true' : undefined}
  >
    {React.Children.map(children, (child) => {
      if (!React.isValidElement(child))
        return child
      return React.cloneElement(child as React.ReactElement<{ __onValueChange?: (value: unknown) => void }>, { __onValueChange: onValueChange })
    })}
  </div>
)

export const DropdownMenuRadioItem = ({
  children,
  value,
  onClick,
  __onValueChange,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode, value?: unknown, __onValueChange?: (value: unknown) => void }) => (
  <div
    role="radio"
    onClick={(event) => {
      onClick?.(event)
      __onValueChange?.(value)
    }}
    {...props}
  >
    {children}
  </div>
)

export const DropdownMenuRadioItemIndicator = ({ children }: { children?: ReactNode }) => <>{children}</>
export const DropdownMenuCheckboxItem = DropdownMenuItem
export const DropdownMenuCheckboxItemIndicator = ({ children }: { children?: ReactNode }) => <>{children}</>
export const DropdownMenuLabel = ({ children }: { children?: ReactNode }) => <>{children}</>
export const DropdownMenuSeparator = (props: React.HTMLAttributes<HTMLDivElement>) => <div role="separator" {...props} />
export const DropdownMenuSub = ({ children }: { children?: ReactNode }) => <>{children}</>
export const DropdownMenuSubTrigger = DropdownMenuItem
export const DropdownMenuSubContent = ({ children }: { children?: ReactNode }) => <>{children}</>
