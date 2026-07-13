'use client'

import type { FocusEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { cloneElement, useState } from 'react'

type TriggerProps = {
  onFocusCapture?: (event: FocusEvent<HTMLElement>) => void
  onPointerOverCapture?: (event: PointerEvent<HTMLElement>) => void
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function contentText(content: ReactNode) {
  if (typeof content === 'string' || typeof content === 'number') return String(content)
}

function isOverflowing(element: HTMLElement) {
  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
}

function shouldShowTooltipContent(element: HTMLElement, content: ReactNode) {
  const text = contentText(content)
  if (text === undefined) return true

  if (normalizeText(text) !== normalizeText(element.textContent ?? '')) return true

  return isOverflowing(element)
}

export function TitleTooltip({
  children,
  content,
}: {
  children: ReactElement
  content?: ReactNode
}) {
  const [shouldShowContent, setShouldShowContent] = useState(false)

  if (!content) return children

  const childProps = children.props as TriggerProps

  function updateShouldShowContent(element: HTMLElement) {
    setShouldShowContent(shouldShowTooltipContent(element, content))
  }

  // oxlint-disable-next-line react/no-clone-element -- Preserve the trigger element while adding overflow checks.
  const trigger = cloneElement(children as ReactElement<TriggerProps>, {
    onFocusCapture: (event) => {
      childProps.onFocusCapture?.(event)
      updateShouldShowContent(event.currentTarget)
    },
    onPointerOverCapture: (event) => {
      childProps.onPointerOverCapture?.(event)
      updateShouldShowContent(event.currentTarget)
    },
  })

  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      {shouldShowContent && <TooltipContent>{content}</TooltipContent>}
    </Tooltip>
  )
}
