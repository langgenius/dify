'use client'

import type { RefObject } from 'react'
import type { StepByStepTourGuideInteractionPolicy } from './target-registry'
import { useLayoutEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[tabindex="0"]',
].join(',')
const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]'
const TOUR_CHECKLIST_SELECTOR = '[data-step-by-step-tour-checklist]'

const isFocusable = (element: HTMLElement) => {
  if (element.tabIndex !== 0 || element.matches(':disabled')) return false
  if (element.closest('[aria-hidden="true"], [hidden], [inert]')) return false

  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

const getFocusableElements = (container: HTMLElement) => {
  const elements = [
    ...(container.matches(FOCUSABLE_SELECTOR) ? [container] : []),
    ...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ]

  return elements.filter(isFocusable)
}

const contains = (container: Element, element: Element | null) =>
  Boolean(element && (container === element || container.contains(element)))

const getExternalModal = (allowedContainers: HTMLElement[]) =>
  Array.from(document.querySelectorAll<HTMLElement>(MODAL_DIALOG_SELECTOR)).find(
    (modal) => !allowedContainers.some((container) => contains(modal, container)),
  )

export const useStepByStepTourFocusScope = ({
  enabled,
  guideId,
  interactionPolicy,
  returnFocusElement,
  scopeRef,
  targetElement,
}: {
  enabled: boolean
  guideId?: string
  interactionPolicy: StepByStepTourGuideInteractionPolicy
  returnFocusElement: HTMLElement | null
  scopeRef: RefObject<HTMLElement | null>
  targetElement: HTMLElement
}) => {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const lastFocusedElementRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const scopeElement = scopeRef.current
    if (!enabled || !scopeElement) return

    if (!returnFocusRef.current?.isConnected) {
      returnFocusRef.current =
        returnFocusElement ??
        (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }

    const allowedContainers =
      interactionPolicy === 'target-only' ? [targetElement, scopeElement] : [scopeElement]
    const getInitialFocus = () =>
      interactionPolicy === 'target-only'
        ? (getFocusableElements(targetElement)[0] ?? scopeElement)
        : scopeElement
    const restoreScopeFocus = () => {
      const lastFocusedElement = lastFocusedElementRef.current
      const focusTarget =
        lastFocusedElement &&
        allowedContainers.some((container) => contains(container, lastFocusedElement))
          ? lastFocusedElement
          : getInitialFocus()

      focusTarget.focus({ preventScroll: true })
    }

    getInitialFocus().focus({ preventScroll: true })
    lastFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return
      if (getExternalModal(allowedContainers)) return

      const focusableElements = allowedContainers.flatMap(getFocusableElements)
      if (focusableElements.length === 0) {
        event.preventDefault()
        scopeElement.focus({ preventScroll: true })
        return
      }

      const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement)
      const nextIndex = event.shiftKey
        ? currentIndex <= 0
          ? focusableElements.length - 1
          : currentIndex - 1
        : currentIndex === -1 || currentIndex === focusableElements.length - 1
          ? 0
          : currentIndex + 1

      event.preventDefault()
      focusableElements[nextIndex]?.focus({ preventScroll: true })
    }

    const handleFocusIn = (event: FocusEvent) => {
      const focusedElement = event.target instanceof HTMLElement ? event.target : null
      if (!focusedElement) return

      if (allowedContainers.some((container) => contains(container, focusedElement))) {
        lastFocusedElementRef.current = focusedElement
        return
      }

      if (getExternalModal(allowedContainers)) return

      queueMicrotask(restoreScopeFocus)
    }

    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('keydown', handleKeyDown, true)

    return () => {
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('keydown', handleKeyDown, true)

      window.requestAnimationFrame(() => {
        if (document.querySelector('[data-step-by-step-tour-coachmark]')) return
        if (getExternalModal(allowedContainers)) return

        const returnFocusElement = returnFocusRef.current
        const checklistElement = document.querySelector<HTMLElement>(TOUR_CHECKLIST_SELECTOR)
        const focusTarget = returnFocusElement?.isConnected
          ? returnFocusElement
          : (getFocusableElements(targetElement)[0] ?? checklistElement)

        focusTarget?.focus({ preventScroll: true })
      })
    }
  }, [enabled, guideId, interactionPolicy, scopeRef, targetElement])
}
