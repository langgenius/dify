'use client'

import { useLayoutEffect, useState } from 'react'

export type Rect = {
  height: number
  left: number
  top: number
  width: number
}

export type ShownStep = {
  anchorRect: Rect
  detached: boolean
  highlightRect: Rect
  parts: HTMLElement[]
  target: HTMLElement
}

type Geometry = Pick<ShownStep, 'anchorRect' | 'highlightRect'>

const HIDDEN_BOUNDARY_SELECTOR = '[aria-hidden="true"], [inert]'
const MAX_SETTLE_READINGS = 8
const LAYOUT_ATTRIBUTES = [
  'class',
  'data-align',
  'data-ending-style',
  'data-side',
  'data-starting-style',
  'hidden',
  'style',
]

const toRect = ({ height, left, top, width }: DOMRect): Rect => ({ height, left, top, width })

const isVisibleRect = (rect: Rect) => rect.width > 0 && rect.height > 0

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
  isSameRect(a.anchorRect, b.anchorRect) && isSameRect(a.highlightRect, b.highlightRect)

const isInViewport = ({ height, left, top, width }: Rect) =>
  top < window.innerHeight && top + height > 0 && left < window.innerWidth && left + width > 0

function measure(target: HTMLElement, parts: HTMLElement[]): Geometry {
  const anchorRect = toRect(target.getBoundingClientRect())
  const partRects = parts
    .filter((part) => part.isConnected)
    .map((part) => toRect(part.getBoundingClientRect()))
    .filter(isVisibleRect)
  return { anchorRect, highlightRect: unionRects([anchorRect, ...partRects]) }
}

function findParts(selectors: string[]) {
  const matches = selectors.map((selector) =>
    Array.from(document.querySelectorAll<HTMLElement>(selector)).filter((element) =>
      isVisibleRect(toRect(element.getBoundingClientRect())),
    ),
  )
  return matches.every((elements) => elements.length > 0) ? matches.flat() : undefined
}

function observeLayout(
  onChange: () => void,
  resizeElements: HTMLElement[],
  mutationTargets: Array<[Node, MutationObserverInit]>,
) {
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(onChange)
  resizeElements.forEach((element) => resizeObserver?.observe(element))
  const mutationObservers = new Map<string, MutationObserver>()
  mutationTargets.forEach(([node, options]) => {
    const key = [
      options.attributes ? 'attributes' : '',
      options.childList ? 'childList' : '',
      options.attributeFilter?.join(',') ?? '',
    ].join(':')
    let observer = mutationObservers.get(key)
    if (!observer) {
      observer = new MutationObserver(onChange)
      mutationObservers.set(key, observer)
    }
    observer.observe(node, options)
  })
  window.addEventListener('resize', onChange)
  window.addEventListener('scroll', onChange, true)

  return () => {
    resizeObserver?.disconnect()
    mutationObservers.forEach((observer) => observer.disconnect())
    window.removeEventListener('resize', onChange)
    window.removeEventListener('scroll', onChange, true)
  }
}

export function useShownStep(
  open: boolean,
  target: HTMLElement | null,
  highlightSelectors: string[] | undefined,
) {
  const [shown, setShown] = useState<ShownStep | null>(null)
  const selectorKey = highlightSelectors?.join('\n') ?? ''
  const shownTarget = shown?.target
  const shownDetached = shown?.detached ?? true

  useLayoutEffect(() => {
    if (!open || !target || (target === shownTarget && !shownDetached)) return
    const nextTarget = target
    const selectors = selectorKey ? selectorKey.split('\n') : []
    const waitsForAccess = shownDetached
    let active = true
    let frame = 0
    let timeout = 0
    let readings = 0
    let previous: Geometry | undefined

    function check() {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      frame = 0
      timeout = 0
      if (!active) return
      const parts = findParts(selectors)
      if (!parts) {
        previous = undefined
        return
      }
      if (waitsForAccess && nextTarget.closest(HIDDEN_BOUNDARY_SELECTOR)) return

      const geometry = measure(nextTarget, parts)
      if (
        !nextTarget.isConnected ||
        !isVisibleRect(geometry.anchorRect) ||
        !isInViewport(geometry.highlightRect)
      )
        return
      if (
        parts.length > 0 &&
        readings < MAX_SETTLE_READINGS &&
        !(previous && isSameGeometry(previous, geometry))
      ) {
        previous = geometry
        readings += 1
        schedule()
        return
      }

      setShown({ ...geometry, detached: false, parts, target: nextTarget })
    }

    function schedule() {
      if (frame) return
      frame = window.requestAnimationFrame(check)
      timeout = window.setTimeout(check, 100)
    }

    const stopObserving = observeLayout(
      schedule,
      [nextTarget],
      [
        [
          document.body,
          {
            attributeFilter: ['aria-hidden', 'inert', ...LAYOUT_ATTRIBUTES],
            attributes: true,
            childList: true,
            subtree: true,
          },
        ],
      ],
    )
    queueMicrotask(check)

    return () => {
      active = false
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      stopObserving()
    }
  }, [open, selectorKey, shownDetached, shownTarget, target])

  const shownParts = shown?.parts
  useLayoutEffect(() => {
    if (!shownTarget || !shownParts || shownDetached) return
    const step = { parts: shownParts, target: shownTarget }
    let frame = 0
    let timeout = 0

    function sync() {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      frame = 0
      setShown((current) => {
        if (current?.target !== step.target || current.detached) return current
        if (!step.target.isConnected) return { ...current, detached: true }
        const geometry = measure(step.target, step.parts)
        return isSameGeometry(current, geometry) ? current : { ...current, ...geometry }
      })
    }

    function schedule() {
      if (frame) return
      frame = window.requestAnimationFrame(sync)
      timeout = window.setTimeout(sync, 100)
    }

    const attributeOptions = { attributeFilter: LAYOUT_ATTRIBUTES, attributes: true }
    const layoutAncestors = new Set<HTMLElement>()
    for (const element of [step.target, ...step.parts]) {
      for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement)
        layoutAncestors.add(ancestor)
    }
    const stopObserving = observeLayout(
      schedule,
      [step.target, ...step.parts],
      [
        [document.body, { childList: true, subtree: true }],
        ...[...layoutAncestors].map((node): [Node, MutationObserverInit] => [node, attributeOptions]),
      ],
    )

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timeout)
      stopObserving()
    }
  }, [shownDetached, shownParts, shownTarget])

  return [shown, setShown] as const
}
