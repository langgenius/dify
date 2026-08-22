'use client'

import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '#i18n'

type MarketplaceDetailDialogFrameProps = {
  open: boolean
  src: string
  title: string
  onMessage?: (data: unknown) => void
  onOpenChange: (open: boolean) => void
}

// The iframe load event can be delayed indefinitely on a stalled connection
// (and cross-origin load errors are not observable), so reveal the frame after
// this timeout instead of keeping the skeleton up forever.
const LOADING_REVEAL_TIMEOUT_MS = 15_000

export default function MarketplaceDetailDialogFrame({
  open,
  src,
  title,
  onMessage,
  onOpenChange,
}: MarketplaceDetailDialogFrameProps) {
  const { t } = useTranslation()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!open) return

    const timeout = window.setTimeout(() => setIsLoading(false), LOADING_REVEAL_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [open, src])

  useEffect(() => {
    if (!open || !onMessage) return

    const marketplaceOrigin = new URL(src, window.location.href).origin
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== marketplaceOrigin)
        return

      onMessage(event.data)
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onMessage, open, src])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setIsLoading(true)
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        {/* Keep initial focus on the visible close control: while the iframe is
            still loading it is inert, so default focus could otherwise land on
            an invisible cross-origin frame. */}
        <DialogPopup
          initialFocus={closeButtonRef}
          className="fixed top-1/2 left-1/2 h-[min(800px,calc(100dvh-48px))] w-[min(1200px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden border-0 p-0 shadow-xl"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <div
            aria-hidden
            className={cn(
              'absolute inset-0 bg-background-default transition-opacity',
              isLoading ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <div className="flex h-[52px] items-center px-6">
              <div className="h-4 w-40 animate-pulse rounded-md bg-state-base-hover motion-reduce:animate-none" />
            </div>
            <div className="mx-auto flex w-full max-w-[1000px] gap-8 px-12 py-8">
              <div className="flex flex-1 flex-col gap-4">
                <div className="h-16 w-2/3 animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
                <div className="h-4 w-full animate-pulse rounded-md bg-state-base-hover motion-reduce:animate-none" />
                <div className="h-4 w-5/6 animate-pulse rounded-md bg-state-base-hover motion-reduce:animate-none" />
                <div className="mt-8 h-72 w-full animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
              </div>
              <div className="hidden w-60 flex-col gap-4 lg:flex">
                <div className="h-24 animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
                <div className="h-52 animate-pulse rounded-xl bg-state-base-hover motion-reduce:animate-none" />
              </div>
            </div>
          </div>
          <iframe
            ref={iframeRef}
            // While loading, remove the invisible frame from focus, pointer,
            // and accessibility interaction until its content is presentable.
            inert={isLoading}
            className={cn(
              'size-full border-0 bg-background-default transition-opacity',
              isLoading ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
            onLoad={() => setIsLoading(false)}
            referrerPolicy="strict-origin-when-cross-origin"
            src={src}
            title={title}
          />
          <DialogClose
            render={
              <IconButton
                ref={closeButtonRef}
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="sm"
                className="absolute top-5 right-5 size-8 rounded-lg"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
