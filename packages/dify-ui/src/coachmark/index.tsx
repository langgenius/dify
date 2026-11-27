'use client'

import type { BaseUIChangeEventDetails } from '@base-ui/react/types'
import type { CoachmarkTarget, Geometry, GeometryStore, ShownStep } from './step'
import { useAnimationsFinished } from '@base-ui/react/internals/useAnimationsFinished'
import { Popover as BasePopover } from '@base-ui/react/popover'
import * as React from 'react'
import { cn } from '../cn'
import { useDirection } from '../direction-provider'
import { floatingPopupAnimationClassName, positionerClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'
import { useMergedRefs } from '../use-merged-refs'
import {
  createGeometryStore,
  HIDDEN_BOUNDARY_SELECTOR,
  isBehindHiddenBoundary,
  isVisibleRect,
  measure,
  useShownStep,
} from './step'

const HIGHLIGHT_PADDING = 4
const ARROW_INSET = 28
const GLIDE_CLASS_NAME =
  'motion-safe:data-gliding:duration-300 motion-safe:data-gliding:ease-[cubic-bezier(0.22,1,0.36,1)]'
const TABBABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
const TARGET_CUTOUT =
  'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, var(--coachmark-target-left) var(--coachmark-target-top), var(--coachmark-target-left) calc(var(--coachmark-target-top) + var(--coachmark-target-height)), calc(var(--coachmark-target-left) + var(--coachmark-target-width)) calc(var(--coachmark-target-top) + var(--coachmark-target-height)), calc(var(--coachmark-target-left) + var(--coachmark-target-width)) var(--coachmark-target-top), var(--coachmark-target-left) var(--coachmark-target-top))'

type CoachmarkModal = true | 'allow-target'
type CoachmarkSide = Exclude<NonNullable<BasePopover.Positioner.Props['side']>, 'left' | 'right'>
type CoachmarkChangeEventReason = Extract<
  BasePopover.Root.ChangeEventReason,
  'close-press' | 'escape-key'
>
type CoachmarkChangeEventDetails = BaseUIChangeEventDetails<CoachmarkChangeEventReason>

type CoachmarkContextValue = {
  closeElements: Set<Element>
  detach: () => void
  gliding: boolean
  modal: CoachmarkModal
  open: boolean
  pending: boolean
  stepKey: number
  positionerRef: React.RefObject<HTMLDivElement | null>
  spotlightRef: React.RefObject<HTMLDivElement | null>
  step: ShownStep<unknown>
  store: GeometryStore
}

const CoachmarkContext = React.createContext<CoachmarkContextValue | null>(null)

function useCoachmarkContext() {
  const context = React.use(CoachmarkContext)
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

function useGliding(
  target: HTMLElement | undefined,
  glideFromPrevious: boolean,
  spotlightRef: React.RefObject<HTMLDivElement | null>,
  positionerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [glide, setGlide] = React.useState({ gliding: false, target })
  if (glide.target !== target)
    setGlide({
      gliding: glideFromPrevious && glide.target !== undefined && target !== undefined,
      target,
    })

  const waitForSpotlight = useAnimationsFinished(spotlightRef)
  const waitForPositioner = useAnimationsFinished(positionerRef)

  React.useEffect(() => {
    if (!glide.gliding) return

    const controller = new AbortController()
    const waits = [
      spotlightRef.current && waitForSpotlight,
      positionerRef.current && waitForPositioner,
    ].filter((wait) => !!wait)
    let remaining = waits.length
    const finish = () => {
      remaining -= 1
      if (remaining <= 0) setGlide((current) => ({ ...current, gliding: false }))
    }
    if (remaining === 0) finish()
    waits.forEach((wait) => wait(finish, controller.signal))
    return () => controller.abort()
  }, [glide, positionerRef, spotlightRef, waitForPositioner, waitForSpotlight])

  return glide.gliding
}

type CoachmarkBaseProps<Payload> = {
  open: boolean
  onOpenChange?: (open: boolean, eventDetails: CoachmarkChangeEventDetails) => void
  onStepShown?: (payload: Payload) => void
  target: CoachmarkTarget
  highlightSelectors?: string[]
  modal?: CoachmarkModal
}

type CoachmarkProps<Payload = undefined> = CoachmarkBaseProps<Payload> &
  (
    | {
        payload: Payload
        children?: React.ReactNode | ((state: { payload: Payload }) => React.ReactNode)
      }
    | { payload?: never; children?: React.ReactNode }
  )

function Coachmark<Payload = undefined>({
  open,
  onOpenChange,
  onStepShown,
  target,
  highlightSelectors,
  modal = true,
  payload,
  children,
}: CoachmarkProps<Payload>) {
  const [store] = React.useState(createGeometryStore)
  const [closeElements] = React.useState(() => new Set<Element>())
  const spotlightRef = React.useRef<HTMLDivElement>(null)
  const positionerRef = React.useRef<HTMLDivElement>(null)
  const [step, setStep] = useShownStep<Payload | undefined>(
    open,
    target,
    highlightSelectors,
    payload,
    store,
  )
  const shown = open && !!step && !step.detached
  const pending =
    shown &&
    (target !== step.targetKey || (highlightSelectors?.join('\n') ?? '') !== step.selectorKey)
  const shownTarget = shown ? step.target : undefined
  const gliding = useGliding(shownTarget, !!step?.glide, spotlightRef, positionerRef)
  const stepKey = shown ? step.key : undefined

  const handleShow = React.useEffectEvent(() => {
    if (step) onStepShown?.(step.payload as Payload)
  })
  React.useEffect(() => {
    if (stepKey !== undefined) handleShow()
  }, [stepKey])

  const shownParts = shown ? step.parts : undefined
  React.useLayoutEffect(() => {
    if (!shownParts || !shownTarget) return
    const inertParts = shownParts.filter((part) => !part.inert && !part.contains(shownTarget))
    inertParts.forEach((part) => {
      part.inert = true
    })
    return () =>
      inertParts.forEach((part) => {
        part.inert = false
      })
  }, [shownParts, shownTarget])

  const detach = React.useCallback(
    () =>
      setStep((current) =>
        current && !current.detached ? { ...current, detached: true } : current,
      ),
    [setStep],
  )

  const handleOpenChange: BasePopover.Root.Props['onOpenChange'] = (nextOpen, eventDetails) => {
    if (eventDetails.reason === 'close-press' || eventDetails.reason === 'escape-key')
      onOpenChange?.(nextOpen, eventDetails)
  }

  const shownPayload = (shown && !pending ? payload : step?.payload) as Payload

  return (
    <BasePopover.Root
      open={shown}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setStep(null)
      }}
      modal={modal === true ? 'trap-focus' : false}
    >
      {step && (
        <CoachmarkContext
          value={{
            closeElements,
            detach,
            gliding,
            modal,
            open: shown,
            pending,
            positionerRef,
            spotlightRef,
            step,
            stepKey: step.key,
            store,
          }}
        >
          {typeof children === 'function' ? children({ payload: shownPayload }) : children}
        </CoachmarkContext>
      )}
    </BasePopover.Root>
  )
}

function applyGeometry(element: HTMLElement, { highlight, target }: Geometry) {
  element.style.setProperty('--coachmark-top', `${highlight.top}px`)
  element.style.setProperty('--coachmark-left', `${highlight.left}px`)
  element.style.setProperty('--coachmark-width', `${highlight.width}px`)
  element.style.setProperty('--coachmark-height', `${highlight.height}px`)
  element.style.setProperty('--coachmark-target-top', `${target.top}px`)
  element.style.setProperty('--coachmark-target-left', `${target.left}px`)
  element.style.setProperty('--coachmark-target-width', `${target.width}px`)
  element.style.setProperty('--coachmark-target-height', `${target.height}px`)
}

type CoachmarkPortalProps = BasePopover.Portal.Props

function CoachmarkPortal({ ref, ...props }: CoachmarkPortalProps) {
  const { detach, open, step, store } = useCoachmarkContext()
  const { target } = step
  const portalRef = React.useRef<HTMLDivElement>(null)
  const geometryRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      const geometry = store.get()
      if (geometry) applyGeometry(element, geometry)
      const unsubscribe = store.subscribe((next) => applyGeometry(element, next))
      const observer = new MutationObserver(() => {
        if (element.closest(HIDDEN_BOUNDARY_SELECTOR)) detach()
      })
      observer.observe(element, { attributeFilter: ['aria-hidden', 'inert'] })
      return () => {
        unsubscribe()
        observer.disconnect()
      }
    },
    [detach, store],
  )
  const mergedRef = useMergedRefs(portalRef, geometryRef, ref)

  const [portalKey, setPortalKey] = React.useState(0)
  React.useLayoutEffect(() => {
    const portal = portalRef.current
    if (
      open &&
      portal &&
      (!portal.closest(HIDDEN_BOUNDARY_SELECTOR) || !isBehindHiddenBoundary(target)) &&
      portal.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING
    )
      setPortalKey((key) => key + 1)
  }, [open, target])

  return <BasePopover.Portal key={portalKey} ref={mergedRef} {...props} />
}

type CoachmarkSpotlightProps = BasePopover.Backdrop.Props

function CoachmarkSpotlight({ className, ref, style, ...props }: CoachmarkSpotlightProps) {
  const { gliding, pending, spotlightRef } = useCoachmarkContext()
  const mergedRef = useMergedRefs(spotlightRef, ref)

  return (
    <BasePopover.Backdrop
      ref={mergedRef}
      data-gliding={gliding ? '' : undefined}
      data-pending={pending ? '' : undefined}
      className={(state) =>
        cn(
          'pointer-events-none fixed rounded-xl shadow-[0_0_0_9999px_var(--color-background-overlay)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:transition-opacity motion-safe:data-gliding:transition-[top,left,width,height,opacity]',
          GLIDE_CLASS_NAME,
          resolveClassName(className, state),
        )
      }
      style={(state) => ({
        height: `calc(var(--coachmark-height) + ${HIGHLIGHT_PADDING * 2}px)`,
        left: `calc(var(--coachmark-left) - ${HIGHLIGHT_PADDING}px)`,
        top: `calc(var(--coachmark-top) - ${HIGHLIGHT_PADDING}px)`,
        width: `calc(var(--coachmark-width) + ${HIGHLIGHT_PADDING * 2}px)`,
        ...(typeof style === 'function' ? style(state) : style),
      })}
      {...props}
    />
  )
}

type CoachmarkPositionerProps = Omit<
  BasePopover.Positioner.Props,
  'align' | 'alignOffset' | 'anchor' | 'side'
> & {
  side?: CoachmarkSide
}

function CoachmarkPositioner({
  className,
  ref,
  side = 'bottom',
  ...props
}: CoachmarkPositionerProps) {
  const { gliding, modal, open, pending, positionerRef, step, store } = useCoachmarkContext()
  const { layout, parts, target } = step
  const mergedRef = useMergedRefs(positionerRef, ref)
  const direction = useDirection()
  const inline = side === 'inline-end' || side === 'inline-start'
  const arrowInset = Math.min(ARROW_INSET, layout.width / 2)

  const anchor = React.useMemo(
    () => ({
      contextElement: target,
      layout,
      getBoundingClientRect() {
        const measured = target.isConnected ? measure(target, parts) : undefined
        const geometry =
          measured && isVisibleRect(measured.target) ? measured : (store.get() ?? measured)
        if (!geometry) return new DOMRect()
        const { highlight, target: targetRect } = geometry
        if (inline)
          return new DOMRect(highlight.left, targetRect.top, highlight.width, targetRect.height)
        const arrowX =
          direction === 'rtl'
            ? targetRect.left + targetRect.width - arrowInset - 2
            : targetRect.left + arrowInset
        return new DOMRect(arrowX, highlight.top, 2, highlight.height)
      },
    }),
    [arrowInset, direction, inline, layout, parts, store, target],
  )

  return (
    <React.Fragment>
      <div
        role="presentation"
        inert={!open}
        className="fixed inset-0 cursor-default select-none"
        onMouseDown={(event) => event.preventDefault()}
        style={{ clipPath: modal === 'allow-target' && !gliding ? TARGET_CUTOUT : undefined }}
      />
      <BasePopover.Positioner
        ref={mergedRef}
        anchor={anchor}
        side={side}
        align={inline ? 'center' : 'start'}
        alignOffset={
          inline ? 0 : -(arrowInset + (direction === 'rtl' ? layout.right : layout.left))
        }
        sideOffset={HIGHLIGHT_PADDING + 21}
        arrowPadding={16}
        collisionPadding={8}
        collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
        positionMethod="fixed"
        sticky
        data-gliding={gliding ? '' : undefined}
        data-pending={pending ? '' : undefined}
        className={(state) =>
          cn(
            positionerClassName,
            'data-anchor-hidden:pointer-events-auto data-anchor-hidden:visible motion-safe:data-gliding:transition-[top,left,transform]',
            GLIDE_CLASS_NAME,
            resolveClassName(className, state),
          )
        }
        {...props}
      />
    </React.Fragment>
  )
}

type CoachmarkPopupProps = BasePopover.Popup.Props

function CoachmarkPopup({
  className,
  initialFocus,
  onClickCapture,
  onKeyDown,
  ref,
  ...props
}: CoachmarkPopupProps) {
  const { closeElements, gliding, modal, open, pending, step } = useCoachmarkContext()
  const { target } = step
  const popupRef = React.useRef<HTMLDivElement>(null)
  const mergedRef = useMergedRefs(popupRef, ref)
  const previousTargetRef = React.useRef(target)

  React.useEffect(() => {
    const previousTarget = previousTargetRef.current
    previousTargetRef.current = target
    const popup = popupRef.current
    if (!open || !popup || previousTarget === target) return

    const activeElement = document.activeElement
    const focusLost =
      !activeElement ||
      activeElement === document.body ||
      !!activeElement.closest(HIDDEN_BOUNDARY_SELECTOR)
    const advanced =
      !!activeElement && (popup.contains(activeElement) || previousTarget.contains(activeElement))
    if (!advanced && !focusLost) return

    const resolved =
      typeof initialFocus === 'function'
        ? initialFocus('keyboard')
        : typeof initialFocus === 'object'
          ? initialFocus.current
          : initialFocus
    if (resolved === false) return
    const focusTarget = resolved instanceof HTMLElement ? resolved : popup
    focusTarget.focus()
  }, [initialFocus, open, target])

  React.useEffect(() => {
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
    <BasePopover.Popup
      ref={mergedRef}
      initialFocus={initialFocus ?? popupRef}
      aria-busy={pending || undefined}
      data-gliding={gliding ? '' : undefined}
      data-pending={pending ? '' : undefined}
      onClickCapture={(event) => {
        onClickCapture?.(event)
        const eventTarget = event.target
        if (
          pending &&
          eventTarget instanceof Node &&
          ![...closeElements].some((element) => element.contains(eventTarget))
        ) {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
      onKeyDown={handleKeyDown}
      className={(state) =>
        cn(
          floatingPopupAnimationClassName,
          'relative flex max-h-(--available-height) w-88 max-w-[calc(100vw-16px)] flex-col rounded-2xl border-[0.5px] border-state-base-hover-alt bg-components-panel-bg-blur-burn bg-linear-to-r from-components-icon-bg-blue-soft to-components-icon-bg-blue-soft p-4 shadow-xl outline-hidden backdrop-blur-[5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type CoachmarkArrowProps = BasePopover.Arrow.Props

function CoachmarkArrow({ className, ...props }: CoachmarkArrowProps) {
  return (
    <BasePopover.Arrow
      className={(state) =>
        cn(
          'pointer-events-none bg-components-panel-bg-blur-burn bg-linear-to-r from-components-icon-bg-blue-soft to-components-icon-bg-blue-soft shadow-xl',
          'before:absolute before:size-3 before:rounded-full before:border-2 before:border-white before:bg-components-button-primary-bg before:shadow-xs before:content-[""]',
          'data-[side=bottom]:-top-6 data-[side=bottom]:h-7 data-[side=bottom]:w-0.5 data-[side=bottom]:before:-top-0.75 data-[side=bottom]:before:left-1/2 data-[side=bottom]:before:-translate-x-1/2',
          'data-[side=top]:-bottom-6 data-[side=top]:h-7 data-[side=top]:w-0.5 data-[side=top]:before:-bottom-0.75 data-[side=top]:before:left-1/2 data-[side=top]:before:-translate-x-1/2',
          'data-[side=inline-end]:-inset-s-6 data-[side=inline-end]:h-0.5 data-[side=inline-end]:w-7 data-[side=inline-end]:before:-inset-s-0.75 data-[side=inline-end]:before:top-1/2 data-[side=inline-end]:before:-translate-y-1/2',
          'data-[side=inline-start]:-inset-e-6 data-[side=inline-start]:h-0.5 data-[side=inline-start]:w-7 data-[side=inline-start]:before:-inset-e-0.75 data-[side=inline-start]:before:top-1/2 data-[side=inline-start]:before:-translate-y-1/2',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

const STEP_FADE_CLASS_NAME =
  'motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0'

type CoachmarkTitleProps = BasePopover.Title.Props

function CoachmarkTitle({ className, ...props }: CoachmarkTitleProps) {
  const { stepKey } = useCoachmarkContext()
  return (
    <BasePopover.Title
      key={stepKey}
      className={(state) =>
        cn(
          'shrink-0 system-md-medium text-text-primary',
          STEP_FADE_CLASS_NAME,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type CoachmarkStepLabelProps = React.ComponentProps<'span'>

function CoachmarkStepLabel({ className, ...props }: CoachmarkStepLabelProps) {
  return (
    <span
      className={cn('block pb-1.5 system-2xs-semibold-uppercase text-text-tertiary', className)}
      {...props}
    />
  )
}

type CoachmarkDescriptionProps = BasePopover.Description.Props

function CoachmarkDescription({ className, ...props }: CoachmarkDescriptionProps) {
  const { stepKey } = useCoachmarkContext()
  return (
    <BasePopover.Description
      key={stepKey}
      className={(state) =>
        cn(
          'mt-1 min-h-0 overflow-y-auto system-xs-regular text-text-secondary',
          STEP_FADE_CLASS_NAME,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type CoachmarkActionsProps = React.ComponentProps<'div'>

function CoachmarkActions({ className, ...props }: CoachmarkActionsProps) {
  return (
    <div
      className={cn('mt-auto flex min-h-12 shrink-0 flex-wrap items-center gap-1 pt-4', className)}
      {...props}
    />
  )
}

type CoachmarkCloseProps = BasePopover.Close.Props

function CoachmarkClose({ className, ref, ...props }: CoachmarkCloseProps) {
  const { closeElements } = useCoachmarkContext()
  const registerRef = React.useCallback(
    (element: HTMLButtonElement | null) => {
      if (!element) return
      closeElements.add(element)
      return () => {
        closeElements.delete(element)
      }
    },
    [closeElements],
  )
  const mergedRef = useMergedRefs(registerRef, ref)
  return (
    <BasePopover.Close
      ref={mergedRef}
      className={(state) =>
        cn(
          'me-auto min-h-6 shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

export {
  Coachmark,
  CoachmarkActions,
  CoachmarkArrow,
  CoachmarkClose,
  CoachmarkDescription,
  CoachmarkPopup,
  CoachmarkPortal,
  CoachmarkPositioner,
  CoachmarkSpotlight,
  CoachmarkStepLabel,
  CoachmarkTitle,
}
export type {
  CoachmarkActionsProps,
  CoachmarkArrowProps,
  CoachmarkChangeEventDetails,
  CoachmarkChangeEventReason,
  CoachmarkCloseProps,
  CoachmarkDescriptionProps,
  CoachmarkPopupProps,
  CoachmarkPortalProps,
  CoachmarkPositionerProps,
  CoachmarkProps,
  CoachmarkSide,
  CoachmarkSpotlightProps,
  CoachmarkStepLabelProps,
  CoachmarkTitleProps,
}
