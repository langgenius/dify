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
import { useEffect, useEffectEvent, useId, useRef } from 'react'

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

const TABBABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const getTabbables = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(
    (element) => !element.matches(':disabled') && (element.checkVisibility?.() ?? true),
  )

// Popups the form opens (icon picker, selects) portal outside this frame and own their keys.
const isInOtherPopup = (frame: HTMLElement, target: EventTarget | null) =>
  target instanceof Element &&
  !frame.contains(target) &&
  !!target.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')

/**
 * The dialog frame rendered in place, so it comes with the server HTML. It keeps
 * the modal behavior the portal dialog has: initial focus, a focus trap, Escape
 * to close and a locked page scroll.
 */
function InlineDialogFrame({
  children,
  contentClassName,
  onClose,
  title,
}: Omit<CreateAppDialogShellProps, 'inline' | 'show'>) {
  const titleId = useId()
  const frameRef = useRef<HTMLDivElement>(null)
  const closeFromKeyboard = useEffectEvent(() => onClose())

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    getTabbables(frame)[0]?.focus()

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInOtherPopup(frame, event.target)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeFromKeyboard()
        return
      }
      if (event.key !== 'Tab') return
      const tabbables = getTabbables(frame)
      const first = tabbables[0]
      const last = tabbables.at(-1)
      if (!first || !last) return
      const active = document.activeElement
      if (event.shiftKey && (active === first || !frame.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !frame.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
    }
  }, [])

  return (
    <div
      ref={frameRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50"
    >
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
    </div>
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
  if (inline) {
    if (!show) return null
    return (
      <InlineDialogFrame contentClassName={contentClassName} onClose={onClose} title={title}>
        {children}
      </InlineDialogFrame>
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
