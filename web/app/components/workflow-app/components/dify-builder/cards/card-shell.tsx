import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

type CardTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const toneClassNames: Record<CardTone, string> = {
  neutral: '',
  info: 'border-state-accent-solid bg-state-accent-hover',
  success: 'border-state-success-solid bg-state-success-hover',
  warning: 'border-state-warning-active bg-state-warning-hover',
  error: 'border-state-destructive-border bg-state-destructive-hover-alt',
}

export const DifyBuilderCardShell = ({
  children,
  invalidated = false,
  tone = 'neutral',
}: {
  children: ReactNode
  invalidated?: boolean
  tone?: CardTone
}) => (
  <div
    data-card-state={invalidated ? 'invalidated' : 'valid'}
    className={cn(
      'rounded-xl border border-components-panel-border-subtle bg-components-panel-bg p-3 shadow-xs',
      toneClassNames[tone],
      invalidated && 'border-divider-regular bg-background-section opacity-70 shadow-none',
    )}
  >
    {children}
  </div>
)
