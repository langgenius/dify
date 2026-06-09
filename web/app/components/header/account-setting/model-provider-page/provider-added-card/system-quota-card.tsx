import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { createContext, use } from 'react'
import styles from './quota-panel.module.css'

type Variant = 'default' | 'destructive'

const VariantContext = createContext<Variant>('default')

const containerVariants: Record<Variant, string> = {
  default: 'border-components-panel-border bg-white/18',
  destructive: 'border-state-destructive-border bg-state-destructive-hover',
}

const labelVariants: Record<Variant, string> = {
  default: 'text-text-secondary',
  destructive: 'text-text-destructive',
}

type SystemQuotaCardProps = {
  variant?: Variant
  children: ReactNode
}

const SystemQuotaCard = ({
  variant = 'default',
  children,
}: SystemQuotaCardProps) => {
  return (
    <VariantContext.Provider value={variant}>
      <div className={cn(
        'relative isolate ml-1 flex w-[128px] shrink-0 flex-col justify-between rounded-lg border-[0.5px] p-1 shadow-xs',
        containerVariants[variant],
      )}
      >
        <div className={cn('pointer-events-none absolute inset-0 rounded-[7px]', styles.gridBg)} />
        {children}
      </div>
    </VariantContext.Provider>
  )
}

const Label = ({ children, className }: { children: ReactNode, className?: string }) => {
  const variant = use(VariantContext)
  return (
    <div className={cn(
      'relative z-1 flex items-center gap-1 truncate px-1.5 pt-1 system-xs-medium',
      className ?? labelVariants[variant],
    )}
    >
      {children}
    </div>
  )
}

const Actions = ({ children }: { children: ReactNode }) => {
  return (
    <div className="relative z-1 flex items-center gap-0.5">
      {children}
    </div>
  )
}

SystemQuotaCard.Label = Label
SystemQuotaCard.Actions = Actions

export default SystemQuotaCard
