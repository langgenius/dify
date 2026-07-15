import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'

type CollapseProps = Omit<ComponentProps<typeof Collapsible>, 'open' | 'onOpenChange'> & {
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
}

export function Collapse({ collapsed, onCollapse, ...props }: CollapseProps) {
  return (
    <Collapsible
      open={collapsed === undefined ? undefined : !collapsed}
      onOpenChange={(open) => onCollapse?.(!open)}
      {...props}
    />
  )
}

type CollapseHeaderProps = {
  children: ReactNode
}

export function CollapseHeader({ children }: CollapseHeaderProps) {
  return <div className="group/collapse flex items-center">{children}</div>
}

type CollapseActionsProps = {
  children: ReactNode
}

export function CollapseActions({ children }: CollapseActionsProps) {
  return <div className="ml-auto shrink-0">{children}</div>
}

type CollapseTriggerProps = ComponentProps<typeof CollapsibleTrigger>

export function CollapseTrigger({ className, ...props }: CollapseTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group/collapse ml-4 flex h-6 min-h-0 w-auto min-w-0 shrink-0 items-center justify-start gap-0 rounded-md px-0 py-0 text-text-secondary hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-secondary data-panel-open:text-text-secondary',
        className,
      )}
      {...props}
    />
  )
}

type CollapseTitleProps = {
  children: ReactNode
  className?: string
}

export function CollapseTitle({ children, className }: CollapseTitleProps) {
  return (
    <span
      className={cn('min-w-0 truncate system-sm-semibold-uppercase text-text-secondary', className)}
    >
      {children}
    </span>
  )
}

export function CollapseIndicator() {
  return (
    <span
      aria-hidden="true"
      className="i-custom-vender-solid-general-arrow-down-round-fill size-4 rotate-270 cursor-pointer text-text-quaternary transition-transform group-hover/collapse:text-text-secondary group-data-panel-open/collapse:rotate-0 motion-reduce:transition-none"
    />
  )
}

type CollapseContentProps = ComponentProps<typeof CollapsiblePanel>

export function CollapseContent({ className, ...props }: CollapseContentProps) {
  return <CollapsiblePanel className={cn(className)} {...props} />
}

type FieldCollapseProps = {
  title: string
  children: ReactNode
  collapsed?: boolean
  onCollapse?: (collapsed: boolean) => void
  actions?: ReactNode
}

export function FieldCollapse({
  title,
  children,
  collapsed,
  onCollapse,
  actions,
}: FieldCollapseProps) {
  return (
    <div className="py-4">
      <Collapse collapsed={collapsed} onCollapse={onCollapse}>
        <CollapseHeader>
          <CollapseTrigger>
            <CollapseTitle>{title}</CollapseTitle>
            <CollapseIndicator />
          </CollapseTrigger>
          {actions != null && <CollapseActions>{actions}</CollapseActions>}
        </CollapseHeader>
        <CollapseContent>
          <div className="px-4">{children}</div>
        </CollapseContent>
      </Collapse>
    </div>
  )
}
