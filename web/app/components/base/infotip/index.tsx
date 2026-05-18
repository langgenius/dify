'use client'

import type { Placement } from '@langgenius/dify-ui/popover'
import type { MouseEvent, ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'

/**
 * Infotip — a `?` icon that reveals a long-form explanation on hover / focus / tap.
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
  /** Accessible name for the trigger. Required; should match the popup text. */
  'aria-label': string
  /** Placement of the popup relative to the trigger. Defaults to `top`. */
  'placement'?: Placement
  /** Extra classes on the outer trigger wrapper (layout / margin). */
  'className'?: string
  /** Extra classes on the `?` icon itself (size / color overrides). */
  'iconClassName'?: string
  /** Extra classes on the popup body (width / padding / whitespace overrides). */
  'popupClassName'?: string
  /** Hover open delay in ms. Defaults to 300 to match the app-wide Tooltip delay. */
  'delay'?: number
  /** Hover close delay in ms. Defaults to 200 to match the app-wide Tooltip delay. */
  'closeDelay'?: number
}

export function Infotip({
  children,
  'aria-label': ariaLabel,
  placement = 'top',
  className,
  iconClassName,
  popupClassName,
  delay = 300,
  closeDelay = 200,
}: InfotipProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={delay}
        closeDelay={closeDelay}
        aria-label={ariaLabel}
        onClick={handleClick}
        className={cn(
          'inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden',
          className,
        )}
      >
        <span aria-hidden className={cn('i-ri-question-line h-3.5 w-3.5 text-text-quaternary hover:text-text-tertiary', iconClassName)} />
      </PopoverTrigger>
      <PopoverContent
        placement={placement}
        popupClassName={cn('max-w-[300px] rounded-md px-3 py-2 system-xs-regular text-text-tertiary', popupClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}
