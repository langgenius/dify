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
  nativeButton?: boolean
  render?: React.ReactElement
}

type PopoverContentProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode
  placement?: string
  sideOffset?: number
  alignOffset?: number
  popupClassName?: string
  positionerProps?: React.HTMLAttributes<HTMLDivElement>
  popupProps?: React.HTMLAttributes<HTMLDivElement>
}

export const Popover = ({
  children,
  open,
  onOpenChange,
}: PopoverProps) => {
  const [localOpen, setLocalOpen] = React.useState(false)
  const resolvedOpen = open ?? localOpen
  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setLocalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  React.useEffect(() => {
    if (!resolvedOpen)
      return

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('[data-popover-trigger="true"], [data-popover-content="true"]'))
        return

      handleOpenChange(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        handleOpenChange(false)
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [resolvedOpen, handleOpenChange])

  return (
    <PopoverContext.Provider value={{
      open: resolvedOpen,
      onOpenChange: handleOpenChange,
    }}
    >
      <div data-testid="popover" data-open={String(resolvedOpen)}>
        {children}
      </div>
    </PopoverContext.Provider>
  )
}

export const PopoverTrigger = ({
  children,
  render,
  nativeButton: _nativeButton,
  onClick,
  ...props
}: PopoverTriggerProps) => {
  const { open, onOpenChange } = React.useContext(PopoverContext)
  const node = render ?? children

  if (React.isValidElement(node)) {
    const triggerElement = node as React.ReactElement<Record<string, unknown>>
    const childProps = (triggerElement.props ?? {}) as React.HTMLAttributes<HTMLElement> & { 'data-testid'?: string }
    const triggerProps = props as React.HTMLAttributes<HTMLElement> & { 'data-testid'?: string }

    return React.cloneElement(triggerElement, {
      ...props,
      ...childProps,
      'data-testid': childProps['data-testid'] ?? triggerProps['data-testid'] ?? 'popover-trigger',
      'data-popover-trigger': 'true',
      'onClick': (event: React.MouseEvent<HTMLElement>) => {
        childProps.onClick?.(event)
        onClick?.(event)
        if (event.defaultPrevented)
          return
        onOpenChange(!open)
      },
    }, render ? (children ?? childProps.children) : childProps.children)
  }

  return (
    <div
      data-testid="popover-trigger"
      data-popover-trigger="true"
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented)
          return
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
  popupClassName,
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
      data-popover-content="true"
      data-placement={placement}
      data-side-offset={sideOffset}
      data-align-offset={alignOffset}
      className={className || popupClassName}
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
