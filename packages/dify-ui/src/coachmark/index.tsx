'use client'

import type { BaseUIChangeEventDetails } from '@base-ui/react/types'
import type { CoachmarkTarget, Geometry, GeometryStore, ShownStep } from './step'
import { useAnimationsFinished } from '@base-ui/react/internals/useAnimationsFinished'
import { Popover as BasePopover } from '@base-ui/react/popover'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { cn } from '../cn'
import { useDirection } from '../direction-provider'
import { checkedControlFocusClassName, focusRingClassName } from '../internal/focus'
import { floatingPopupAnimationClassName, positionerClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'
import { useMergedRefs } from '../use-merged-refs'
import {
  createGeometryStore,
  getSelectorKey,
  HIDDEN_BOUNDARY_SELECTOR,
  isVisibleRect,
  measure,
  useShownStep,
} from './step'

const HIGHLIGHT_PADDING = 4
const ARROW_INSET = 28
const GLIDE_CLASS_NAME =
  'motion-safe:data-gliding:duration-300 motion-safe:data-gliding:ease-[cubic-bezier(0.22,1,0.36,1)]'
const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'details > summary:first-of-type',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex^="-"])',
].join(', ')
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
  positionerRef: React.RefObject<HTMLDivElement | null>
  setPortalElement: (element: HTMLDivElement | null) => void
  spotlightRef: React.RefObject<HTMLDivElement | null>
  step: ShownStep<unknown>
  stepKey: number
  store: GeometryStore
}

const CoachmarkContext = React.createContext<CoachmarkContextValue | null>(null)

function useCoachmarkContext() {
  const context = React.use(CoachmarkContext)
  if (!context) throw new Error('Coachmark parts must be rendered inside <Coachmark>.')
  return context
}

function getTabbables(root: Element) {
  const candidates = [
    ...(root.matches(TABBABLE_SELECTOR) ? [root] : []),
    ...root.querySelectorAll(TABBABLE_SELECTOR),
  ].filter(
    (element): element is HTMLElement | SVGElement =>
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      !element.closest('[hidden], [inert]') &&
      (typeof element.checkVisibility !== 'function' ||
        element.checkVisibility({ visibilityProperty: true })),
  )

  const checkedRadioGroups = new Set<string>()
  for (const element of candidates) {
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      if (element.checked) checkedRadioGroups.add(element.name)
    }
  }

  const seenUncheckedRadioGroups = new Set<string>()
  return candidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || !element.name)
      return true
    if (checkedRadioGroups.has(element.name)) return element.checked
    if (seenUncheckedRadioGroups.has(element.name)) return false
    seenUncheckedRadioGroups.add(element.name)
    return true
  })
}

function inertOutside(avoidElements: Element[]) {
  const body = document.body
  const liveElements = Array.from(body.querySelectorAll('[aria-live]'))
  const keepRoots = [...avoidElements, ...liveElements].filter((element) => body.contains(element))
  const stopSet = new Set<Node>(keepRoots)
  const keepAncestors = new Set<Node>()
  for (const element of keepRoots) {
    let node: Node | null = element
    while (node && !keepAncestors.has(node)) {
      keepAncestors.add(node)
      node = node.parentNode
    }
  }

  const inerted: HTMLElement[] = []
  const hidden: Array<[Element, string | null]> = []
  const walk = (parent: Element) => {
    if (stopSet.has(parent)) return
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE') continue
      if (keepAncestors.has(child)) {
        walk(child)
      } else {
        if (child instanceof HTMLElement && !child.inert) {
          child.inert = true
          inerted.push(child)
        }
        const ariaHidden = child.getAttribute('aria-hidden')
        if (ariaHidden === null || ariaHidden === 'false') {
          child.setAttribute('aria-hidden', 'true')
          hidden.push([child, ariaHidden])
        }
      }
    }
  }
  walk(body)

  return () => {
    for (const element of inerted) element.inert = false
    for (const [element, previous] of hidden) {
      if (previous === null) element.removeAttribute('aria-hidden')
      else element.setAttribute('aria-hidden', previous)
    }
  }
}

function applyHighlightGeometry(element: HTMLElement, { highlight }: Geometry) {
  element.style.setProperty('--coachmark-top', `${highlight.top}px`)
  element.style.setProperty('--coachmark-left', `${highlight.left}px`)
  element.style.setProperty('--coachmark-width', `${highlight.width}px`)
  element.style.setProperty('--coachmark-height', `${highlight.height}px`)
}

function applyTargetGeometry(element: HTMLElement, { target }: Geometry) {
  element.style.setProperty('--coachmark-target-top', `${target.top}px`)
  element.style.setProperty('--coachmark-target-left', `${target.left}px`)
  element.style.setProperty('--coachmark-target-width', `${target.width}px`)
  element.style.setProperty('--coachmark-target-height', `${target.height}px`)
}

function useGeometryRef(
  store: GeometryStore,
  apply: (element: HTMLElement, geometry: Geometry) => void,
  enabled = true,
) {
  return React.useCallback(
    (element: HTMLDivElement | null) => {
      if (!element || !enabled) return
      const geometry = store.get()
      if (geometry) apply(element, geometry)
      return store.subscribe((next) => apply(element, next))
    },
    [apply, enabled, store],
  )
}

function useGliding(
  target: Element | undefined,
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

type CoachmarkBaseProps = {
  open: boolean
  onOpenChange?: (open: boolean, eventDetails: CoachmarkChangeEventDetails) => void
  target: CoachmarkTarget
  highlightSelectors?: string[]
  modal?: CoachmarkModal
}

type CoachmarkProps<Payload = undefined> = CoachmarkBaseProps &
  (
    | {
        payload: Payload | undefined
        onStepShown?: (payload: Payload) => void
        children?: React.ReactNode | ((state: { payload: Payload }) => React.ReactNode)
      }
    | {
        payload?: never
        onStepShown?: () => void
        children?: React.ReactNode
      }
  )

function Coachmark<Payload = undefined>(props: CoachmarkProps<Payload>) {
  const {
    open,
    onOpenChange,
    onStepShown,
    target,
    highlightSelectors,
    modal = true,
    children,
  } = props
  const hasPayload = 'payload' in props
  const payload = hasPayload ? props.payload : undefined
  const payloadReady = !hasPayload || payload !== undefined

  const [store] = React.useState(createGeometryStore)
  const [closeElements] = React.useState(() => new Set<Element>())
  const [portalElement, setPortalElement] = React.useState<HTMLDivElement | null>(null)
  const spotlightRef = React.useRef<HTMLDivElement>(null)
  const positionerRef = React.useRef<HTMLDivElement>(null)
  const [step, setStep] = useShownStep<Payload | undefined>(
    open,
    target,
    highlightSelectors,
    payload,
    payloadReady,
    store,
  )
  const shown = open && !!step && !step.detached
  const pending =
    shown &&
    (!payloadReady ||
      target !== step.targetKey ||
      getSelectorKey(highlightSelectors) !== step.selectorKey)
  const shownTarget = shown ? step.target : undefined
  const gliding = useGliding(shownTarget, !!step?.glide, spotlightRef, positionerRef)
  const stepKey = shown ? step.key : undefined

  const handleShow = React.useEffectEvent(() => {
    if (step) (onStepShown as ((payload: Payload) => void) | undefined)?.(step.payload as Payload)
  })
  React.useEffect(() => {
    if (stepKey !== undefined) handleShow()
  }, [stepKey])

  const shownParts = shown ? step.parts : undefined
  React.useLayoutEffect(() => {
    if (!shownParts || !shownTarget) return
    const inertParts = shownParts.filter(
      (part): part is HTMLElement =>
        part instanceof HTMLElement &&
        !part.inert &&
        !part.contains(shownTarget) &&
        !shownTarget.contains(part),
    )
    inertParts.forEach((part) => {
      part.inert = true
    })
    return () =>
      inertParts.forEach((part) => {
        part.inert = false
      })
  }, [shownParts, shownTarget])

  // Base UI uses `modal={false}` in `allow-target` mode so the target stays interactive.
  // Marking outside subtrees `inert` and `aria-hidden="true"` isolates both keyboard focus and
  // assistive technology to the popup, target, and live regions.
  React.useLayoutEffect(() => {
    if (modal !== 'allow-target' || !shown || !portalElement || !shownTarget) return
    return inertOutside([portalElement, shownTarget])
  }, [modal, portalElement, shown, shownTarget])

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

  const shownPayload = (shown && !pending && payloadReady ? payload : step?.payload) as Payload

  const contextValue = React.useMemo<CoachmarkContextValue | null>(
    () =>
      step
        ? {
            closeElements,
            detach,
            gliding,
            modal,
            open: shown,
            pending,
            positionerRef,
            setPortalElement,
            spotlightRef,
            step,
            stepKey: step.key,
            store,
          }
        : null,
    [closeElements, detach, gliding, modal, pending, shown, step, store],
  )

  return (
    <BasePopover.Root
      open={shown}
      onOpenChange={handleOpenChange}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) setStep(null)
      }}
      modal={modal === true ? 'trap-focus' : false}
    >
      {contextValue && (
        <CoachmarkContext value={contextValue}>
          {typeof children === 'function' ? children({ payload: shownPayload }) : children}
        </CoachmarkContext>
      )}
    </BasePopover.Root>
  )
}

type CoachmarkPortalProps = BasePopover.Portal.Props

function CoachmarkPortal({ ref, ...props }: CoachmarkPortalProps) {
  const { detach, setPortalElement } = useCoachmarkContext()
  const portalRef = React.useCallback(
    (element: HTMLDivElement | null) => {
      setPortalElement(element)
      if (!element) return
      const observer = new MutationObserver(() => {
        if (element.closest(HIDDEN_BOUNDARY_SELECTOR)) detach()
      })
      observer.observe(element, { attributeFilter: ['aria-hidden', 'inert'] })
      return () => {
        observer.disconnect()
        setPortalElement(null)
      }
    },
    [detach, setPortalElement],
  )
  const mergedRef = useMergedRefs(portalRef, ref)

  return <BasePopover.Portal ref={mergedRef} {...props} />
}

type CoachmarkSpotlightProps = BasePopover.Backdrop.Props

function CoachmarkSpotlight({ className, ref, style, ...props }: CoachmarkSpotlightProps) {
  const { gliding, pending, spotlightRef, store } = useCoachmarkContext()
  const geometryRef = useGeometryRef(store, applyHighlightGeometry)
  const mergedRef = useMergedRefs(spotlightRef, geometryRef, ref)

  return (
    <BasePopover.Backdrop
      ref={mergedRef}
      data-gliding={gliding ? '' : undefined}
      data-pending={pending ? '' : undefined}
      className={(state) =>
        cn(
          'pointer-events-none fixed inset-s-0 top-0 rounded-xl shadow-[0_0_0_9999px_var(--color-background-overlay)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-safe:transition-opacity motion-safe:data-gliding:transition-[transform,width,height,opacity]',
          GLIDE_CLASS_NAME,
          resolveClassName(className, state),
        )
      }
      style={(state) => ({
        height: `calc(var(--coachmark-height) + ${HIGHLIGHT_PADDING * 2}px)`,
        transform: `translate3d(calc(var(--coachmark-left) - ${HIGHLIGHT_PADDING}px), calc(var(--coachmark-top) - ${HIGHLIGHT_PADDING}px), 0)`,
        width: `calc(var(--coachmark-width) + ${HIGHLIGHT_PADDING * 2}px)`,
        ...(typeof style === 'function' ? style(state) : style),
      })}
      {...props}
    />
  )
}

type CoachmarkPositionerProps = Omit<
  BasePopover.Positioner.Props,
  'align' | 'alignOffset' | 'anchor' | 'positionMethod' | 'side'
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
  const blockerGeometryRef = useGeometryRef(store, applyTargetGeometry, modal === 'allow-target')
  const direction = useDirection()
  const inline = side === 'inline-end' || side === 'inline-start'
  const arrowInset = Math.min(ARROW_INSET, layout.width / 2)

  const anchor = React.useMemo(
    () => ({
      contextElement: target,
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
    [arrowInset, direction, inline, parts, store, target],
  )

  return (
    <React.Fragment>
      <div
        ref={blockerGeometryRef}
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
            // Keep the popup visible and reachable when a target scrolls outside its scroll container.
            'data-anchor-hidden:pointer-events-auto data-anchor-hidden:visible motion-safe:data-gliding:transition-transform',
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

function getReferencedText(root: Element, attribute: 'aria-describedby' | 'aria-labelledby') {
  const ids = root.getAttribute(attribute)?.trim()
  if (!ids) return ''
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
}

function CoachmarkPopup({
  className,
  initialFocus,
  onClickCapture,
  onKeyDown,
  ref,
  ...props
}: CoachmarkPopupProps) {
  const { closeElements, gliding, modal, open, pending, step, stepKey } = useCoachmarkContext()
  const { target } = step
  const popupRef = React.useRef<HTMLDivElement>(null)
  const mergedRef = useMergedRefs(popupRef, ref)
  const previousTargetRef = React.useRef(target)
  const previousStepKeyRef = React.useRef<number | undefined>(undefined)
  const liveRegionRef = React.useRef<HTMLSpanElement>(null)

  React.useEffect(() => {
    if (!open) {
      previousStepKeyRef.current = undefined
      if (liveRegionRef.current) liveRegionRef.current.textContent = ''
      return
    }
    const previousTarget = previousTargetRef.current
    previousTargetRef.current = target
    const previousStepKey = previousStepKeyRef.current
    previousStepKeyRef.current = stepKey
    const popup = popupRef.current
    if (!popup || previousStepKey === undefined || previousStepKey === stepKey) return

    const activeElement = document.activeElement
    let movedFocusToPopup = false

    if (previousTarget !== target) {
      const focusLost =
        !activeElement ||
        activeElement === document.body ||
        !!activeElement.closest(HIDDEN_BOUNDARY_SELECTOR)
      const advanced =
        !!activeElement && (popup.contains(activeElement) || previousTarget.contains(activeElement))

      if (advanced || focusLost) {
        const resolved =
          typeof initialFocus === 'function' ? initialFocus('keyboard') : initialFocus
        if (resolved !== false && !(typeof initialFocus === 'function' && resolved === undefined)) {
          let focusTarget: HTMLElement | SVGElement = popup
          if (resolved === true || (typeof initialFocus === 'function' && resolved === null)) {
            focusTarget = getTabbables(popup)[0] ?? popup
          } else if (resolved && typeof resolved === 'object') {
            const candidate = 'current' in resolved ? resolved.current : resolved
            if (candidate instanceof HTMLElement) focusTarget = candidate
          }
          if (focusTarget !== activeElement) {
            movedFocusToPopup = focusTarget === popup
            focusTarget.focus()
          }
        }
      }
    }

    if (!liveRegionRef.current) return
    if (movedFocusToPopup) {
      liveRegionRef.current.textContent = ''
      return
    }

    liveRegionRef.current.textContent = [
      getReferencedText(popup, 'aria-labelledby'),
      getReferencedText(popup, 'aria-describedby'),
    ]
      .filter(Boolean)
      .join('. ')
  }, [initialFocus, open, stepKey, target])

  React.useEffect(() => {
    const popup = popupRef.current
    if (modal !== 'allow-target' || !popup) return

    const handleTargetKeyDown = (event: Event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'Tab' || event.defaultPrevented) return
      const targetTabbables = getTabbables(target)
      const popupTabbables = getTabbables(popup)
      const next = (event.shiftKey ? popupTabbables.at(-1) : popupTabbables[0]) ?? popup
      const boundary = event.shiftKey ? targetTabbables[0] : targetTabbables.at(-1)
      if (boundary && event.target !== boundary) return

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
      ? (targetTabbables.at(-1) ?? popupTabbables.at(-1) ?? popup)
      : (targetTabbables[0] ?? popupTabbables[0] ?? popup)
    const atBoundary = event.shiftKey ? index <= 0 : index === popupTabbables.length - 1
    if (!atBoundary) return

    event.preventDefault()
    next.focus()
  }

  return (
    <React.Fragment>
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
            checkedControlFocusClassName,
            'relative flex max-h-(--available-height) w-88 max-w-[min(var(--available-width,100dvw),calc(100dvw-16px))] flex-col rounded-2xl border-[0.5px] border-state-base-hover-alt bg-components-panel-bg-blur-burn bg-linear-to-r from-components-icon-bg-blue-soft to-components-icon-bg-blue-soft p-4 shadow-xl outline-hidden backdrop-blur-[5px] focus-visible:outline-solid',
            resolveClassName(className, state),
          )
        }
        {...props}
      />
      {open &&
        typeof document !== 'undefined' &&
        ReactDOM.createPortal(
          <span
            ref={liveRegionRef}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          />,
          document.body,
        )}
    </React.Fragment>
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
  'block motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0'

type CoachmarkTitleProps = BasePopover.Title.Props

function CoachmarkTitle({ children, className, ...props }: CoachmarkTitleProps) {
  const { stepKey } = useCoachmarkContext()
  return (
    <BasePopover.Title
      className={(state) =>
        cn('shrink-0 system-md-medium text-text-primary', resolveClassName(className, state))
      }
      {...props}
    >
      <span key={stepKey} className={STEP_FADE_CLASS_NAME}>
        {children}
      </span>
    </BasePopover.Title>
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

function CoachmarkDescription({ children, className, ...props }: CoachmarkDescriptionProps) {
  const { stepKey } = useCoachmarkContext()
  return (
    <BasePopover.Description
      className={(state) =>
        cn(
          'mt-1 min-h-0 overflow-y-auto system-xs-regular text-text-secondary',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      <span key={stepKey} className={STEP_FADE_CLASS_NAME}>
        {children}
      </span>
    </BasePopover.Description>
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
          focusRingClassName,
          'me-auto min-h-6 shrink-0 rounded-md border-none bg-transparent p-0 text-start system-sm-regular text-text-tertiary hover:text-text-secondary',
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
  CoachmarkModal,
  CoachmarkPopupProps,
  CoachmarkPortalProps,
  CoachmarkPositionerProps,
  CoachmarkProps,
  CoachmarkSide,
  CoachmarkSpotlightProps,
  CoachmarkStepLabelProps,
  CoachmarkTarget,
  CoachmarkTitleProps,
}
