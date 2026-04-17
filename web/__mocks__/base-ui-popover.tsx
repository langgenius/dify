import type { ReactNode } from 'react'
import * as React from 'react'

const PopoverContext = React.createContext({
  open: false,
  onOpenChange: (_open: boolean) => {},
})

type PopoverProps = {
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type PopoverTriggerProps = React.HTMLAttributes<HTMLElement> & {
  children?: ReactNode
  render?: React.ReactElement
}

type PopoverContentProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
  placement?: string
  sideOffset?: number
  alignOffset?: number
  positionerProps?: React.HTMLAttributes<HTMLDivElement>
  popupProps?: React.HTMLAttributes<HTMLDivElement>
}

export const Popover = ({
  children,
  open = false,
  onOpenChange,
}: PopoverProps) => {
  return (
    <PopoverContext.Provider value={{
      open,
      onOpenChange: onOpenChange ?? (() => {}),
    }}
    >
      <div data-testid="popover" data-open={String(open)}>
        {children}
      </div>
    </PopoverContext.Provider>
  )
}

export const PopoverTrigger = ({
  children,
  render,
  onClick,
  ...props
}: PopoverTriggerProps) => {
  const { open, onOpenChange } = React.useContext(PopoverContext)
  const node = render ?? children

  if (React.isValidElement(node)) {
    const triggerElement = node as React.ReactElement<React.HTMLAttributes<HTMLElement> & { 'data-testid'?: string }>
    const childProps = triggerElement.props ?? {}

    return React.cloneElement(triggerElement, {
      ...props,
      ...childProps,
      'data-testid': childProps['data-testid'] ?? 'popover-trigger',
      'onClick': (event: React.MouseEvent<HTMLElement>) => {
        childProps.onClick?.(event)
        onClick?.(event)
        onOpenChange(!open)
      },
    })
  }

  return (
    <div
      data-testid="popover-trigger"
      onClick={(event) => {
        onClick?.(event)
        onOpenChange(!open)
      }}
      {...props}
    >
      {node}
    </div>
  )
}

export const PopoverContent = ({
  children,
  className,
  placement,
  sideOffset,
  alignOffset,
  positionerProps,
  popupProps,
  ...props
}: PopoverContentProps) => {
  const { open } = React.useContext(PopoverContext)

  if (!open)
    return null

  return (
    <div
      data-testid="popover-content"
      data-placement={placement}
      data-side-offset={sideOffset}
      data-align-offset={alignOffset}
      className={className}
      {...positionerProps}
      {...popupProps}
      {...props}
    >
      {children}
    </div>
  )
}

export const PopoverClose = ({ children }: { children?: ReactNode }) => <>{children}</>
export const PopoverTitle = ({ children }: { children?: ReactNode }) => <>{children}</>
export const PopoverDescription = ({ children }: { children?: ReactNode }) => <>{children}</>
