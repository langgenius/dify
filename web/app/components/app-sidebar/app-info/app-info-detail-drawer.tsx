import type { ReactNode } from 'react'

type AppInfoDetailDrawerProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
}

export function AppInfoDetailDrawer({
  open,
  onClose,
  children,
}: AppInfoDetailDrawerProps) {
  if (!open)
    return null

  return (
    <div className="absolute inset-0 z-50">
      <button
        type="button"
        aria-label="Close app info"
        className="absolute inset-0 cursor-default bg-app-detail-overlay-bg"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="false"
        className="absolute top-2 bottom-2 left-2 flex w-[452px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border-r border-divider-burn bg-app-detail-bg"
      >
        {children}
      </section>
    </div>
  )
}
