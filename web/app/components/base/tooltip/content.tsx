import type { FC, PropsWithChildren, ReactNode } from 'react'

export type ToolTipContentProps = {
  title?: ReactNode
  action?: ReactNode
} & PropsWithChildren

export const ToolTipContent: FC<ToolTipContentProps> = ({
  title,
  action,
  children,
}) => {
  return (
    <div className="w-[180px]" data-testid="tooltip-content">
      {!!title && (
        <div className="mb-1.5 font-semibold text-text-secondary" data-testid="tooltip-content-title">{title}</div>
      )}
      <div className="mb-1.5 text-text-tertiary" data-testid="tooltip-content-body">{children}</div>
      {!!action && <div className="cursor-pointer text-text-accent" data-testid="tooltip-content-action">{action}</div>}
    </div>
  )
}
