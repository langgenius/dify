'use client'

import type {
  PopoverArrowProps,
  PopoverBackdropProps,
  PopoverChangeEventDetails,
  PopoverChangeEventReason,
  PopoverCloseProps,
  PopoverPopupProps,
  PopoverPositionerProps,
  PopoverProps,
} from '@langgenius/dify-ui/popover'
import type { ReactNode, RefObject } from 'react'
import type { ShownStep } from './use-shown-step'
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
import { useShownStep } from './use-shown-step'

const HIGHLIGHT_PADDING = 4
const GLIDE_CLASS_NAME =
  'motion-safe:data-gliding:duration-300 motion-safe:data-gliding:ease-[cubic-bezier(0.22,1,0.36,1)]'
const HIDDEN_BOUNDARY_SELECTOR = '[aria-hidden="true"], [inert]'
const TABBABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

type CoachmarkModal = boolean | 'allow-target'
type CoachmarkSide = 'bottom' | 'inline-end' | 'inline-start' | 'top'
type CoachmarkChangeEventReason = Extract<PopoverChangeEventReason, 'close-press' | 'escape-key'>
type CoachmarkChangeEventDetails = PopoverChangeEventDetails & {
  reason: CoachmarkChangeEventReason
}

type CoachmarkContextValue = {
  gliding: boolean
  modal: CoachmarkModal
  open: boolean
  pending: boolean
  step: ShownStep
}

const CoachmarkContext = createContext<CoachmarkContextValue | null>(null)

function useCoachmarkContext() {
  const context = use(CoachmarkContext)
  if (!context) throw new Error('Coachmark parts must be rendered inside <Coachmark>.')
  return context
}

function getTabbables(root: HTMLElement) {
  return [
    ...(root.matches(TABBABLE_SELECTOR) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR),
  ].filter(
    (element) =>
      !element.closest('[hidden], [inert]') &&
      (typeof element.checkVisibility !== 'function' ||
        element.checkVisibility({ visibilityProperty: true })),
  )
}

function useGliding(target: HTMLElement | undefined) {
  const [glide, setGlide] = useState({ gliding: false, target })
  if (glide.target !== target)
    setGlide({ gliding: glide.target !== undefined && target !== undefined, target })

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

type CoachmarkProps = {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean, eventDetails: CoachmarkChangeEventDetails) => void
  target: HTMLElement | null
  highlightSelectors?: string[]
  modal?: CoachmarkModal
  children?: ReactNode
}

function Coachmark({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  target,
  highlightSelectors,
  modal = true,
  children,
}: CoachmarkProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const [step, setStep] = useShownStep(open, target, highlightSelectors)
  const shown = open && !!step && !step.detached
  const pending = shown && target !== step.target
  const gliding = useGliding(shown ? step.target : undefined)

  const shownChildrenRef = useRef(children)
  useLayoutEffect(() => {
    if (!pending) shownChildrenRef.current = children
  })

  const handleOpenChange: PopoverProps['onOpenChange'] = (nextOpen, eventDetails) => {
    if (eventDetails.reason !== 'close-press' && eventDetails.reason !== 'escape-key') return
    onOpenChange?.(nextOpen, eventDetails as CoachmarkChangeEventDetails)
    if (!eventDetails.isCanceled) setUncontrolledOpen(nextOpen)
  }

  return (
    <Popover
      open={shown}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setStep(null)
      }}
      modal={modal === true ? 'trap-focus' : false}
    >
      {step && (
        <CoachmarkContext value={{ gliding, modal, open: shown, pending, step }}>
          {pending ? shownChildrenRef.current : children}
        </CoachmarkContext>
      )}
    </Popover>
  )
}

const getSpotlightRect = ({ highlightRect }: ShownStep) => ({
  height: highlightRect.height + HIGHLIGHT_PADDING * 2,
  left: highlightRect.left - HIGHLIGHT_PADDING,
  top: highlightRect.top - HIGHLIGHT_PADDING,
  width: highlightRect.width + HIGHLIGHT_PADDING * 2,
})

type CoachmarkPortalProps = {
  children?: ReactNode
}

function CoachmarkPortal({ children }: CoachmarkPortalProps) {
  const { gliding, modal, open, step } = useCoachmarkContext()
  const { target } = step
  const portalRef = useRef<HTMLDivElement>(null)

  const [portalKey, setPortalKey] = useState(0)
  useLayoutEffect(() => {
    const portal = portalRef.current
    if (
      open &&
      portal &&
      (!portal.closest(HIDDEN_BOUNDARY_SELECTOR) || !target.closest(HIDDEN_BOUNDARY_SELECTOR)) &&
      portal.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING
    )
      setPortalKey((key) => key + 1)
  }, [open, target])

  const { height, left, top, width } = getSpotlightRect(step)

  return (
    <PopoverPortal key={portalKey} ref={portalRef} className="aria-hidden:invisible">
      {open && modal !== false && (
        <div
          aria-hidden="true"
          className="fixed inset-0 cursor-default"
          style={{
            clipPath:
              modal === 'allow-target' && !gliding
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
  const { gliding, step } = useCoachmarkContext()

  return (
    <PopoverBackdrop
      data-gliding={gliding ? '' : undefined}
      className={cn(
        'pointer-events-none inset-auto rounded-xl shadow-[0_0_0_9999px_var(--color-background-overlay)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:transition-opacity motion-safe:data-gliding:transition-[top,left,width,height,opacity]',
        GLIDE_CLASS_NAME,
        className,
      )}
      style={getSpotlightRect(step)}
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
  const { gliding, step } = useCoachmarkContext()
  const { anchorRect, highlightRect } = step
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
      className={cn(
        'motion-safe:data-gliding:transition-[top,left,transform]',
        GLIDE_CLASS_NAME,
        className,
      )}
      {...props}
    />
  )
}

type CoachmarkPopupProps = Omit<PopoverPopupProps, 'className' | 'initialFocus'> & {
  className?: string
  initialFocus?: RefObject<HTMLElement | null>
}

function CoachmarkPopup({
  className,
  initialFocus,
  finalFocus = false,
  onClickCapture,
  onKeyDown,
  ref,
  ...props
}: CoachmarkPopupProps) {
  const { modal, open, pending, step } = useCoachmarkContext()
  const { target } = step
  const popupRef = useRef<HTMLDivElement>(null)
  const mergedRef = useMergedRefs(popupRef, ref)
  const previousTargetRef = useRef(target)

  useEffect(() => {
    const previousTarget = previousTargetRef.current
    previousTargetRef.current = target
    const popup = popupRef.current
    if (!open || !popup) return

    const activeElement = document.activeElement
    const focusLost =
      !activeElement ||
      activeElement === document.body ||
      !!activeElement.closest(HIDDEN_BOUNDARY_SELECTOR)
    const advanced =
      previousTarget !== target &&
      !!activeElement &&
      (popup.contains(activeElement) || previousTarget.contains(activeElement))
    if (focusLost || advanced) (initialFocus?.current ?? popup).focus()
  }, [initialFocus, open, target])

  useEffect(() => {
    const popup = popupRef.current
    if (modal !== 'allow-target' || !popup) return

    const handleTargetKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return
      const targetTabbables = getTabbables(target)
      const popupTabbables = getTabbables(popup)
      const next = event.shiftKey ? popupTabbables.at(-1) : popupTabbables[0]
      const boundary = event.shiftKey ? targetTabbables[0] : targetTabbables.at(-1)
      if (!next || event.target !== boundary) return

      event.preventDefault()
      next.focus()
    }

    target.addEventListener('keydown', handleTargetKeyDown)
    return () => target.removeEventListener('keydown', handleTargetKeyDown)
  }, [modal, target])

  const handleKeyDown: CoachmarkPopupProps['onKeyDown'] = (event) => {
    onKeyDown?.(event)
    const popup = popupRef.current
    if (modal !== 'allow-target' || event.key !== 'Tab' || event.defaultPrevented || !popup) return

    const targetTabbables = getTabbables(target)
    const popupTabbables = getTabbables(popup)
    const index = popupTabbables.findIndex((element) => element === document.activeElement)
    const next = event.shiftKey
      ? (targetTabbables.at(-1) ?? popupTabbables.at(-1))
      : (targetTabbables[0] ?? popupTabbables[0])
    const atBoundary = event.shiftKey ? index <= 0 : index === popupTabbables.length - 1
    if (!next || !atBoundary) return

    event.preventDefault()
    next.focus()
  }

  return (
    <PopoverPopup
      ref={mergedRef}
      initialFocus={() => initialFocus?.current ?? popupRef.current}
      finalFocus={finalFocus}
      data-pending={pending ? '' : undefined}
      onClickCapture={(event) => {
        onClickCapture?.(event)
        if (
          pending &&
          event.target instanceof Element &&
          !event.target.closest('[data-coachmark-close]')
        ) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onKeyDown={handleKeyDown}
      className={cn(
        'relative flex max-h-(--available-height) w-88 max-w-[calc(100vw-16px)] flex-col rounded-2xl border-[0.5px] border-state-accent-hover-alt bg-state-accent-hover p-4 shadow-[0_20px_24px_-4px_var(--color-shadow-shadow-5),0_8px_8px_-4px_var(--color-shadow-shadow-1)] backdrop-blur-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
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
                ? '-inset-s-1.5 border-s-[0.5px] border-b-[0.5px] [clip-path:polygon(0_0,0_100%,100%_100%)]'
                : '-inset-e-1.5 border-e-[0.5px] border-t-[0.5px] [clip-path:polygon(0_0,100%_0,100%_100%)]',
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

function CoachmarkClose(props: CoachmarkCloseProps) {
  return <PopoverClose data-coachmark-close="" {...props} />
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
export type {
  CoachmarkArrowProps,
  CoachmarkChangeEventDetails,
  CoachmarkChangeEventReason,
  CoachmarkCloseProps,
  CoachmarkModal,
  CoachmarkPopupProps,
  CoachmarkPortalProps,
  CoachmarkPositionerProps,
  CoachmarkProps,
  CoachmarkSide,
  CoachmarkSpotlightProps,
}
