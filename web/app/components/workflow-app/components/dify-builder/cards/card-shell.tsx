import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export type DifyBuilderCardTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const TONE_CLASS_NAMES: Record<DifyBuilderCardTone, string> = {
  neutral: '',
  info: 'border-state-accent-solid bg-state-accent-hover',
  success: 'border-state-success-solid bg-state-success-hover',
  warning: 'border-components-badge-status-light-warning-halo bg-state-warning-hover',
  error: 'border-state-destructive-border bg-state-destructive-hover-alt',
}

export const DifyBuilderCardShell = ({
  children,
  className,
  footer,
  header,
  tone = 'neutral',
  active = false,
  invalidated = false,
}: {
  children: ReactNode
  className?: string
  footer?: ReactNode
  header?: ReactNode
  tone?: DifyBuilderCardTone
  active?: boolean
  invalidated?: boolean
}) => (
  <div
    data-card-state={invalidated ? 'invalidated' : active ? 'active' : 'idle'}
    className={cn(
      'rounded-xl border border-components-panel-border-subtle bg-components-panel-bg p-3 shadow-xs',
      TONE_CLASS_NAMES[tone],
      active && 'border-state-accent-solid',
      invalidated && 'border-divider-regular bg-background-section shadow-none',
      className,
    )}
  >
    {header && <div className="mb-2">{header}</div>}
    {children}
    {footer && <div className="mt-3 border-t border-divider-subtle pt-3">{footer}</div>}
  </div>
)
