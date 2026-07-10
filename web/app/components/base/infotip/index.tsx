'use client'

import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'

const iconClassNames = {
  question: 'i-ri-question-line',
  information: 'i-ri-information-line',
} as const

const iconSizeClassNames = {
  small: 'size-3',
  medium: 'size-3.5',
  large: 'size-4',
} as const

type InfotipIconVariant = keyof typeof iconClassNames
type InfotipIconSize = keyof typeof iconSizeClassNames

/**
 * Infotip — an info glyph that reveals a long-form explanation on hover / focus / tap.
 *
 * Implements the pattern Base UI calls an "infotip":
 * https://base-ui.com/react/components/tooltip#infotips
 *
 * > "Popups that open when hovering an info icon should use Popover with the
 * > `openOnHover` prop on the trigger instead of a tooltip. This way, touch
 * > users and screen reader users can access the content."
 *
 * Use whenever the trigger is an info glyph whose sole purpose is to open a
 * popup (help text, documentation-style explanation). Do NOT use `Tooltip` for
 * this — Tooltip is reserved for ephemeral, non-interactive visual labels that
 * are unreachable on touch devices and by screen readers.
 *
 * Base UI rule of thumb:
 *
 * > "If the trigger's purpose is to open the popup itself, it's a popover.
 * > If the trigger's purpose is unrelated to opening the popup, it's a tooltip."
 *
 * For hover-revealed supplementary previews of a link / row trigger that has
 * its own primary click destination, use `PreviewCard` instead.
 */

type InfotipProps = {
  /** Popup content. Rich nodes are allowed. */
  'children': ReactNode
  /** Concise accessible name for the trigger. */
  'aria-label': string
  /** Extra classes on the trigger for contextual layout and color. */
  'className'?: string
  /** Icon glyph. Defaults to `question`. */
  'iconVariant'?: InfotipIconVariant
  /** Icon size. Defaults to `medium` (14px). */
  'iconSize'?: InfotipIconSize
  /** Extra classes on the popup body (width / padding / whitespace overrides). */
  'popupClassName'?: string
  /** Hover open delay in ms. Defaults to 300 to match the app-wide Tooltip delay. */
  'delay'?: number
}

export function Infotip({
  children,
  'aria-label': ariaLabel,
  className,
  iconVariant = 'question',
  iconSize = 'medium',
  popupClassName,
  delay = 300,
}: InfotipProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={delay}
        closeDelay={200}
        aria-label={ariaLabel}
        onClick={handleClick}
        className={cn(
          'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-text-quaternary outline-hidden hover:text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid',
          className,
        )}
      >
        <span aria-hidden className={cn(iconClassNames[iconVariant], iconSizeClassNames[iconSize])} />
      </PopoverTrigger>
      <PopoverContent
        placement="top"
        popupClassName={cn('max-w-[300px] rounded-md px-3 py-2 system-xs-regular text-text-tertiary', popupClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
