'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useId } from 'react'

type CreateAppDialogShellProps = {
  children: ReactNode
  contentClassName?: string
  /**
   * Renders the same frame in place instead of in a portal, for a route that is
   * only this dialog: portals render on the client only, so this one server-renders.
   */
  inline?: boolean
  onClose: () => void
  show: boolean
  title: ReactNode
}

const frameClassName = 'fixed top-0 left-0 h-screen w-screen overflow-hidden overscroll-contain p-4'
const backdropClassName = 'bg-background-overlay-backdrop backdrop-blur-[6px]'

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      className="absolute inset-e-3 top-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover"
      onClick={onClick}
    >
      <span
        aria-hidden="true"
        className="i-ri-close-large-line size-3.5 text-components-button-tertiary-text"
      />
    </button>
  )
}

export function CreateAppDialogShell({
  children,
  contentClassName,
  inline = false,
  onClose,
  show,
  title,
}: CreateAppDialogShellProps) {
  const titleId = useId()
  if (inline) {
    if (!show) return null
    return (
      <section aria-labelledby={titleId} className="fixed inset-0 z-50">
        <div className={cn('absolute inset-0', backdropClassName)} />
        <div className={frameClassName}>
          <div className="size-full rounded-2xl border border-effects-highlight bg-background-default-subtle">
            <div className={cn('relative h-full overflow-hidden', contentClassName)}>
              <h1 id={titleId} className="sr-only">
                {title}
              </h1>
              <CloseButton onClick={onClose} />
              {children}
            </div>
          </div>
        </div>
      </section>
    )
  }

  return (
    <Dialog
      open={show}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop className={backdropClassName} />
        <DialogPopup className={frameClassName}>
          <div className="size-full rounded-2xl border border-effects-highlight bg-background-default-subtle">
            <div className={cn('relative h-full overflow-hidden', contentClassName)}>
              <DialogTitle className="sr-only">{title}</DialogTitle>
              <CloseButton onClick={onClose} />
              {children}
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
