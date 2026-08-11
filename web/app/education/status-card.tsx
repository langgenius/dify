import type { ReactNode } from 'react'

type EducationStatusCardProps = {
  actions?: ReactNode
  children?: ReactNode
  icon: ReactNode
  title: ReactNode
}

export function EducationStatusCard({ actions, children, icon, title }: EducationStatusCardProps) {
  return (
    <section className="rounded-xl border border-effects-highlight bg-background-default-subtle p-6 shadow-xs">
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background-section-burn">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="title-xl-semi-bold text-text-primary">{title}</h2>
          {children && <div className="mt-2 system-md-regular text-text-tertiary">{children}</div>}
          {actions && <div className="mt-6 flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </div>
    </section>
  )
}
