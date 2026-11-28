'use client'

import * as React from 'react'

export type Rect = {
  height: number
  left: number
  top: number
  width: number
}

export type Geometry = {
  highlight: Rect
  target: Rect
}

export type Layout = {
  bottom: number
  left: number
  right: number
  top: number
  width: number
}

export type CoachmarkTarget = Element | string | null

export type ShownStep<Payload> = {
  detached: boolean
  glide: boolean
  key: number
  layout: Layout
  parts: Element[]
  payload: Payload
  selectorKey: string
  target: Element
  targetKey: Element | string
}

export type GeometryStore = {
  get: () => Geometry | undefined
  set: (geometry: Geometry) => void
  subscribe: (listener: (geometry: Geometry) => void) => () => void
}

export const HIDDEN_BOUNDARY_SELECTOR = '[aria-hidden="true"], [inert]'

const isBehindHiddenBoundary = (element: Element) =>
  !!element.parentElement?.closest(HIDDEN_BOUNDARY_SELECTOR)
const LAYOUT_ATTRIBUTES = ['class', 'hidden', 'style']

const toRect = ({ height, left, top, width }: DOMRect): Rect => ({ height, left, top, width })

export const isVisibleRect = (rect: Rect) => rect.width > 0 && rect.height > 0

export const getSelectorKey = (highlightSelectors: string[] | undefined) =>
  highlightSelectors?.length ? JSON.stringify(highlightSelectors) : ''

const unionRects = (rects: Rect[]): Rect => {
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.left + rect.width))
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height))
  return { height: bottom - top, left, top, width: right - left }
}

const isSameRect = (a: Rect, b: Rect) =>
  Math.abs(a.height - b.height) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5

const isSameGeometry = (a: Geometry, b: Geometry) =>
  isSameRect(a.target, b.target) && isSameRect(a.highlight, b.highlight)

const isSameLayout = (a: Layout, b: Layout) =>
  Math.abs(a.bottom - b.bottom) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.right - b.right) < 0.5 &&
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5

const intersectsViewport = ({ height, left, top, width }: Rect) =>
  top < window.innerHeight && top + height > 0 && left < window.innerWidth && left + width > 0

const isInsideViewport = ({ height, left, top, width }: Rect) =>
  top >= 0 && left >= 0 && top + height <= window.innerHeight && left + width <= window.innerWidth

const STARTING_STYLE_SELECTOR = '[data-starting-style]'

const isStarting = (element: Element) =>
  !!element.closest(STARTING_STYLE_SELECTOR) || !!element.querySelector(STARTING_STYLE_SELECTOR)

const getSettlingAnimations = (elements: Element[]) =>
  (document.getAnimations?.() ?? []).filter((animation) => {
    const effectTarget = animation.effect instanceof KeyframeEffect ? animation.effect.target : null
    return (
      animation.playState === 'running' &&
      Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)) &&
      !!effectTarget &&
      elements.some((element) => effectTarget.contains(element) || element.contains(effectTarget))
    )
  })

function querySelectorSafe(selector: string) {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

function querySelectorAllSafe(selector: string) {
  try {
    return Array.from(document.querySelectorAll(selector))
  } catch {
    return []
  }
}

export function measure(target: Element, parts: Element[]): Geometry {
  const targetRect = toRect(target.getBoundingClientRect())
  const partRects = parts
    .filter((part) => part.isConnected)
    .map((part) => toRect(part.getBoundingClientRect()))
    .filter(isVisibleRect)
  return { highlight: unionRects([targetRect, ...partRects]), target: targetRect }
}

const toLayout = ({ highlight, target }: Geometry): Layout => ({
  bottom: highlight.top + highlight.height - (target.top + target.height),
  left: target.left - highlight.left,
  right: highlight.left + highlight.width - (target.left + target.width),
  top: target.top - highlight.top,
  width: target.width,
})

export function createGeometryStore(): GeometryStore {
  let current: Geometry | undefined
  const listeners = new Set<(geometry: Geometry) => void>()
  return {
    get: () => current,
    set(geometry) {
      if (current && isSameGeometry(current, geometry)) return
      current = geometry
      listeners.forEach((listener) => listener(geometry))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function findParts(selectors: string[]) {
  const matches = selectors.map((selector) =>
    querySelectorAllSafe(selector).filter((element) =>
      isVisibleRect(toRect(element.getBoundingClientRect())),
    ),
  )
  return matches.every((elements) => elements.length > 0) ? matches.flat() : undefined
}

function observeLayout(
  onChange: () => void,
  resizeElements: Element[],
  mutationTargets: Array<[Node, MutationObserverInit]>,
) {
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onChange)
  resizeElements.forEach((element) => resizeObserver?.observe(element))
  const mutationObserver = new MutationObserver(onChange)
  mutationTargets.forEach(([node, options]) => mutationObserver.observe(node, options))
  window.addEventListener('resize', onChange)
  window.addEventListener('scroll', onChange, { capture: true, passive: true })

  return () => {
    resizeObserver?.disconnect()
    mutationObserver.disconnect()
    window.removeEventListener('resize', onChange)
    window.removeEventListener('scroll', onChange, { capture: true })
  }
}

function scheduler(run: () => void, fallbackTimeoutMs = 0) {
  let frame = 0
  let timeout = 0
  const cancel = () => {
    window.cancelAnimationFrame(frame)
    window.clearTimeout(timeout)
    frame = 0
    timeout = 0
  }
  return {
    cancel,
    run() {
      cancel()
      run()
    },
    schedule() {
      if (frame || timeout) return
      frame = window.requestAnimationFrame(() => {
        cancel()
        run()
      })
      if (fallbackTimeoutMs > 0) {
        timeout = window.setTimeout(() => {
          cancel()
          run()
        }, fallbackTimeoutMs)
      }
    },
  }
}

export function useShownStep<Payload>(
  open: boolean,
  target: CoachmarkTarget,
  highlightSelectors: string[] | undefined,
  payload: Payload,
  payloadReady: boolean,
  store: GeometryStore,
) {
  const [shown, setShown] = React.useState<ShownStep<Payload> | null>(null)
  const selectorKey = getSelectorKey(highlightSelectors)
  const shownTarget = shown?.target
  const shownTargetKey = shown?.targetKey
  const shownSelectorKey = shown?.selectorKey
  const shownDetached = shown?.detached ?? true
  const readPayload = React.useEffectEvent(() => payload)

  React.useLayoutEffect(() => {
    if (
      !open ||
      !target ||
      !payloadReady ||
      (target === shownTargetKey && selectorKey === shownSelectorKey && !shownDetached)
    )
      return
    const targetKey = target
    const selectors: string[] = selectorKey ? (JSON.parse(selectorKey) as string[]) : []
    const waitsForAccess = shownDetached
    let active = true
    let scrolled = false

    const checker = scheduler(() => {
      if (!active) return
      const nextTarget = typeof targetKey === 'string' ? querySelectorSafe(targetKey) : targetKey
      const parts = findParts(selectors)
      if (!nextTarget || !parts) return
      if (waitsForAccess && isBehindHiddenBoundary(nextTarget)) return
      if (!nextTarget.isConnected) return
      const elements = [nextTarget, ...parts]
      if (elements.some(isStarting)) return
      const animations = getSettlingAnimations(elements)
      if (animations.length > 0) {
        void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
          if (active) checker.schedule()
        })
        return
      }

      let geometry = measure(nextTarget, parts)
      if (!isVisibleRect(geometry.target)) return
      if (!scrolled && !isInsideViewport(geometry.highlight)) {
        scrolled = true
        nextTarget.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' })
        geometry = measure(nextTarget, parts)
      }
      if (!intersectsViewport(geometry.highlight)) return

      const nextPayload = readPayload()
      const glide =
        !!shownTarget &&
        !shownDetached &&
        shownTarget.isConnected &&
        isVisibleRect(toRect(shownTarget.getBoundingClientRect()))
      setShown((current) => ({
        detached: false,
        glide,
        key: (current?.key ?? 0) + 1,
        layout: toLayout(geometry),
        parts,
        payload: nextPayload,
        selectorKey,
        target: nextTarget,
        targetKey,
      }))
    }, 100)

    const stopObserving = observeLayout(
      checker.schedule,
      typeof targetKey === 'string' ? [] : [targetKey],
      [
        [
          document.body,
          {
            attributeFilter: ['aria-hidden', 'data-starting-style', 'inert', ...LAYOUT_ATTRIBUTES],
            attributes: true,
            childList: true,
            subtree: true,
          },
        ],
      ],
    )
    queueMicrotask(checker.run)

    return () => {
      active = false
      checker.cancel()
      stopObserving()
    }
  }, [
    open,
    payloadReady,
    selectorKey,
    shownDetached,
    shownSelectorKey,
    shownTarget,
    shownTargetKey,
    target,
  ])

  const shownParts = shown?.parts
  React.useLayoutEffect(() => {
    if (!shownTarget || !shownParts || !shownTargetKey || shownDetached) return
    const step = { parts: shownParts, target: shownTarget, targetKey: shownTargetKey }
    const detachCurrent = () =>
      setShown((current) =>
        current?.target === step.target && !current.detached
          ? { ...current, detached: true }
          : current,
      )

    const follower = scheduler(() => {
      if (
        !step.target.isConnected ||
        (typeof step.targetKey === 'string' && querySelectorSafe(step.targetKey) !== step.target)
      ) {
        detachCurrent()
        return
      }
      const geometry = measure(step.target, step.parts)
      if (!isVisibleRect(geometry.target)) {
        detachCurrent()
        return
      }
      store.set(geometry)
      const layout = toLayout(geometry)
      setShown((current) =>
        current?.target !== step.target || current.detached || isSameLayout(current.layout, layout)
          ? current
          : { ...current, layout },
      )
    })

    follower.run()

    const attributeOptions = { attributeFilter: LAYOUT_ATTRIBUTES, attributes: true }
    const stopObserving = observeLayout(
      follower.schedule,
      [step.target, ...step.parts],
      [
        [document.body, { childList: true, subtree: true }],
        ...[step.target, ...step.parts, ...step.parts.map((part) => part.parentElement)]
          .filter((node): node is Element => !!node)
          .map((node): [Node, MutationObserverInit] => [node, attributeOptions]),
      ],
    )

    return () => {
      follower.cancel()
      stopObserving()
    }
  }, [shownDetached, shownParts, shownTarget, shownTargetKey, store])

  return [shown, setShown] as const
}
