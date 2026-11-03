import type { ReactNode } from 'react'

export function SettingsFieldRow({ children, label }: { children: ReactNode; label: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:gap-1">
      <div className="flex h-7 w-full shrink-0 items-center pt-1 system-sm-semibold text-text-secondary sm:w-45">
        {label}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
