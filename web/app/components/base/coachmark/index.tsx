'use client'

import type {
  PopoverArrowProps,
  PopoverBackdropProps,
  PopoverCloseProps,
  PopoverPopupProps,
  PopoverPositionerProps,
  PopoverProps,
} from '@langgenius/dify-ui/popover'
import type { ReactNode, RefObject } from 'react'
import type { TargetRect } from './use-target-rects'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverArrow,
  PopoverBackdrop,
  PopoverClose,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
} from '@langgenius/dify-ui/popover'
import { useMergedRefs } from '@langgenius/dify-ui/use-merged-refs'
import { createContext, use, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTargetRects } from './use-target-rects'
import { waitForAccessibleElement } from './wait-for-accessible-element'

const HIGHLIGHT_PADDING = 4
const GLIDE_CLASS_NAME =
  'data-gliding:duration-300 data-gliding:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
const TABBABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

type CoachmarkInteraction = 'blocked' | 'target-only' | 'unblocked'
type CoachmarkSide = 'bottom' | 'inline-end' | 'inline-start' | 'top'

type CoachmarkOverlay<Payload> = {
  anchorRect: TargetRect
  highlightRect: TargetRect
  interaction: CoachmarkInteraction
  payload: Payload
  step: string
}

type CoachmarkContextValue = {
  open: boolean
  overlay: CoachmarkOverlay<unknown>
  gliding: boolean
  readyStep: string | undefined
  spotlightRect: TargetRect
  target: HTMLElement | null
}

const CoachmarkContext = createContext<CoachmarkContextValue | null>(null)

function useCoachmarkContext() {
  const context = use(CoachmarkContext)
  if (!context) throw new Error('Coachmark parts must be rendered inside <Coachmark>.')
  return context
}

const isRectInViewport = ({ height, left, top, width }: TargetRect) =>
  top < window.innerHeight && top + height > 0 && left < window.innerWidth && left + width > 0

function useGliding(step: string | undefined) {
  const [glide, setGlide] = useState({ gliding: false, step })
  if (glide.step !== step)
    setGlide({ gliding: glide.step !== undefined && step !== undefined, step })

  useEffect(() => {
    if (!glide.gliding) return

    const timeout = window.setTimeout(
      () => setGlide((current) => ({ ...current, gliding: false })),
      400,
    )
    return () => window.clearTimeout(timeout)
  }, [glide])

  return glide.gliding
}

type CoachmarkRenderState<Payload> = {
  payload: Payload
  stale: boolean
}

type CoachmarkProps<Payload = undefined> = {
  target: HTMLElement | null
  targetPending?: boolean
  highlightSelectors?: string[]
  step?: string
  payload?: Payload
  interaction?: CoachmarkInteraction
  onOpenChange?: PopoverProps['onOpenChange']
  children: ReactNode | ((state: CoachmarkRenderState<Payload>) => ReactNode)
}

function Coachmark<Payload = undefined>({
  target,
  targetPending = false,
  highlightSelectors,
  step = '',
  payload,
  interaction = 'blocked',
  onOpenChange,
  children,
}: CoachmarkProps<Payload>) {
  const targetRects = useTargetRects(target, highlightSelectors)
  const lastOverlayRef = useRef<CoachmarkOverlay<Payload> | undefined>(undefined)

  const currentOverlay: CoachmarkOverlay<Payload> | undefined =
    target &&
    !targetPending &&
    targetRects?.targetElement === target &&
    targetRects.highlightPartsReady &&
    targetRects.rectSettled
      ? {
          anchorRect: targetRects.anchorRect,
          highlightRect: targetRects.highlightRect,
          interaction,
          payload: payload as Payload,
          step,
        }
      : undefined

  const [awaitingTarget, setAwaitingTarget] = useState(true)
  if (!target && !awaitingTarget) setAwaitingTarget(true)
  const canOpen = !!currentOverlay && isRectInViewport(currentOverlay.highlightRect)
  useLayoutEffect(() => {
    if (awaitingTarget && canOpen && target)
      return waitForAccessibleElement(target, () => setAwaitingTarget(false))
  }, [awaitingTarget, canOpen, target])

  useLayoutEffect(() => {
    if (currentOverlay) lastOverlayRef.current = currentOverlay
  })

  const overlay = currentOverlay ?? lastOverlayRef.current
  const open = Boolean(!awaitingTarget && overlay)
  const gliding = useGliding(open ? overlay?.step : undefined)

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      modal={overlay?.interaction === 'blocked' ? 'trap-focus' : false}
    >
      {overlay && (
        <CoachmarkContext
          value={{
            gliding,
            open,
            overlay,
            readyStep: currentOverlay?.step,
            spotlightRect: {
              height: overlay.highlightRect.height + HIGHLIGHT_PADDING * 2,
              left: overlay.highlightRect.left - HIGHLIGHT_PADDING,
              top: overlay.highlightRect.top - HIGHLIGHT_PADDING,
              width: overlay.highlightRect.width + HIGHLIGHT_PADDING * 2,
            },
            target,
          }}
        >
          {typeof children === 'function'
            ? children({ payload: overlay.payload, stale: !currentOverlay })
            : children}
        </CoachmarkContext>
      )}
    </Popover>
  )
}

type CoachmarkPortalProps = {
  children?: ReactNode
}

function CoachmarkPortal({ children }: CoachmarkPortalProps) {
  const { open, overlay, spotlightRect, target } = useCoachmarkContext()
  const portalRef = useRef<HTMLDivElement>(null)

  const [portalKey, setPortalKey] = useState(0)
  useLayoutEffect(() => {
    const portal = portalRef.current
    if (
      open &&
      portal &&
      target &&
      (!portal.closest('[aria-hidden="true"], [inert]') ||
        !target.closest('[aria-hidden="true"], [inert]')) &&
      portal.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING
    )
      setPortalKey((key) => key + 1)
  }, [open, target])

  const { height, left, top, width } = spotlightRect

  return (
    <PopoverPortal key={portalKey} ref={portalRef} className="aria-hidden:invisible">
      {open && overlay.interaction !== 'unblocked' && (
        <div
          aria-hidden="true"
          className="fixed inset-0 cursor-default"
          style={{
            clipPath:
              overlay.interaction === 'target-only'
                ? `polygon(evenodd,0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,${left}px ${top}px,${left}px ${top + height}px,${left + width}px ${top + height}px,${left + width}px ${top}px,${left}px ${top}px)`
                : undefined,
          }}
        />
      )}
      {children}
    </PopoverPortal>
  )
}

type CoachmarkSpotlightProps = Omit<PopoverBackdropProps, 'className' | 'style'> & {
  className?: string
}

function CoachmarkSpotlight({ className, ...props }: CoachmarkSpotlightProps) {
  const { gliding, spotlightRect } = useCoachmarkContext()

  return (
    <PopoverBackdrop
      data-gliding={gliding ? '' : undefined}
      className={cn(
        'pointer-events-none inset-auto rounded-xl shadow-[0_0_0_9999px_var(--color-background-overlay)] transition-opacity data-ending-style:opacity-0 data-gliding:transition-[top,left,width,height,opacity] data-starting-style:opacity-0',
        GLIDE_CLASS_NAME,
        className,
      )}
      style={spotlightRect}
      {...props}
    />
  )
}

type CoachmarkPositionerProps = Omit<
  PopoverPositionerProps,
  'align' | 'alignOffset' | 'anchor' | 'className' | 'side'
> & {
  className?: string
  side?: CoachmarkSide
}

function CoachmarkPositioner({ className, side = 'bottom', ...props }: CoachmarkPositionerProps) {
  const { gliding, overlay } = useCoachmarkContext()
  const { anchorRect, highlightRect } = overlay
  const inline = side === 'inline-end' || side === 'inline-start'

  const anchoring = useMemo(() => {
    if (inline) {
      const rect = new DOMRect(
        highlightRect.left,
        anchorRect.top,
        highlightRect.width,
        anchorRect.height,
      )
      return { anchor: { getBoundingClientRect: () => rect }, alignOffset: 0 }
    }

    const arrowLeft = anchorRect.left + 28
    const rect = new DOMRect(arrowLeft, highlightRect.top, 2, highlightRect.height)
    return {
      anchor: { getBoundingClientRect: () => rect },
      alignOffset: highlightRect.left - arrowLeft,
    }
  }, [inline, highlightRect, anchorRect])

  return (
    <PopoverPositioner
      anchor={anchoring.anchor}
      side={side}
      align={inline ? 'center' : 'start'}
      alignOffset={anchoring.alignOffset}
      sideOffset={20}
      arrowPadding={12}
      collisionPadding={8}
      collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
      positionMethod="fixed"
      data-gliding={gliding ? '' : undefined}
      className={cn('data-gliding:transition-[top,left,transform]', GLIDE_CLASS_NAME, className)}
      {...props}
    />
  )
}

type CoachmarkPopupProps = Omit<PopoverPopupProps, 'className' | 'finalFocus' | 'initialFocus'> & {
  className?: string
  initialFocus?: RefObject<HTMLElement | null>
}

function CoachmarkPopup({ className, initialFocus, ref, ...props }: CoachmarkPopupProps) {
  const { readyStep } = useCoachmarkContext()
  const popupRef = useRef<HTMLDivElement>(null)
  const mergedRef = useMergedRefs(popupRef, ref)

  useEffect(() => {
    const popup = popupRef.current
    if (readyStep === undefined || !popup) return

    const activeElement = document.activeElement
    if (
      activeElement &&
      activeElement !== document.body &&
      !activeElement.closest('[aria-hidden="true"]')
    )
      return

    ;(initialFocus?.current ?? popup).focus()
  }, [readyStep, initialFocus])

  return (
    <PopoverPopup
      ref={mergedRef}
      initialFocus={() => initialFocus?.current ?? popupRef.current}
      finalFocus={false}
      className={cn(
        'relative flex w-88 max-w-[calc(100vw-16px)] flex-col rounded-2xl border-[0.5px] border-state-accent-hover-alt bg-state-accent-hover p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
        className,
      )}
      {...props}
    />
  )
}

type CoachmarkArrowProps = Omit<PopoverArrowProps, 'className' | 'render'>

function CoachmarkArrow(props: CoachmarkArrowProps) {
  return (
    <PopoverArrow
      className={(state) =>
        state.side === 'inline-end' || state.side === 'inline-start'
          ? cn(
              'pointer-events-none size-3 rotate-45 border-state-accent-hover-alt bg-state-accent-hover',
              state.side === 'inline-end'
                ? '-inset-s-1.5 border-s-[0.5px] border-b-[0.5px]'
                : '-inset-e-1.5 border-e-[0.5px] border-t-[0.5px]',
            )
          : cn(
              'pointer-events-none h-7 w-0.5',
              state.side === 'top' ? '-bottom-4.75 rotate-180' : '-top-4.75',
            )
      }
      render={(arrowProps, state) => (
        <div {...arrowProps}>
          {(state.side === 'top' || state.side === 'bottom') && (
            <>
              <span className="absolute top-0 left-1/2 h-7 w-0.5 -translate-x-1/2 bg-state-accent-hover-alt shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)]" />
              <span className="absolute -top-0.75 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-state-accent-hover bg-state-accent-solid shadow-xs" />
            </>
          )}
        </div>
      )}
      {...props}
    />
  )
}

const CoachmarkTitle = PopoverTitle
const CoachmarkDescription = PopoverDescription

type CoachmarkCloseProps = PopoverCloseProps

function CoachmarkClose({ onKeyDown, ...props }: CoachmarkCloseProps) {
  const { overlay, target } = useCoachmarkContext()

  const handleKeyDown: CoachmarkCloseProps['onKeyDown'] = (event) => {
    onKeyDown?.(event)
    if (
      event.defaultPrevented ||
      overlay.interaction !== 'target-only' ||
      event.key !== 'Tab' ||
      event.shiftKey ||
      !target
    )
      return

    const targetTabbable = target.matches(TABBABLE_SELECTOR)
      ? target
      : target.querySelector<HTMLElement>(TABBABLE_SELECTOR)
    if (!targetTabbable) return

    event.preventDefault()
    targetTabbable.focus()
  }

  return <PopoverClose onKeyDown={handleKeyDown} {...props} />
}

export {
  Coachmark,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkDescription,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkTitle,
}
export type { CoachmarkInteraction, CoachmarkSide }
