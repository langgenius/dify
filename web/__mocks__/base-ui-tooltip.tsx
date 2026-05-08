import type { ReactNode } from 'react'
import * as React from 'react'

const TooltipContext = React.createContext({
  open: false,
  onOpenChange: (_open: boolean) => {},
})

type TooltipProps = {
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export const Tooltip = ({ children, open, onOpenChange }: TooltipProps) => {
  const [localOpen, setLocalOpen] = React.useState(false)
  const resolvedOpen = open ?? localOpen
  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setLocalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [onOpenChange])

  return (
    <TooltipContext.Provider value={{ open: resolvedOpen, onOpenChange: handleOpenChange }}>
      {children}
    </TooltipContext.Provider>
  )
}

export const TooltipTrigger = ({
  children,
  render,
  nativeButton: _nativeButton,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: ReactNode, render?: React.ReactElement, nativeButton?: boolean }) => {
  const { open, onOpenChange } = React.useContext(TooltipContext)
  const node = render ?? children

  if (React.isValidElement(node)) {
    const triggerElement = node as React.ReactElement<Record<string, unknown>>
    const childProps = (triggerElement.props ?? {}) as React.HTMLAttributes<HTMLElement>

    return React.cloneElement(triggerElement, {
      ...props,
      ...childProps,
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseEnter?.(event)
        props.onMouseEnter?.(event)
        onOpenChange(true)
      },
      onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseLeave?.(event)
        props.onMouseLeave?.(event)
        onOpenChange(false)
      },
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onClick?.(event)
        props.onClick?.(event)
        onOpenChange(!open)
      },
    })
  }

  return (
    <span
      {...props}
      onMouseEnter={(event) => {
        props.onMouseEnter?.(event)
        onOpenChange(true)
      }}
      onMouseLeave={(event) => {
        props.onMouseLeave?.(event)
        onOpenChange(false)
      }}
      onClick={(event) => {
        props.onClick?.(event)
        onOpenChange(!open)
      }}
    >
      {node}
    </span>
  )
}

export const TooltipContent = ({
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) => {
  const { open } = React.useContext(TooltipContext)
  if (!open)
    return null
  return <div {...props}>{children}</div>
}

export const TooltipProvider = ({ children }: { children?: ReactNode }) => <>{children}</>
