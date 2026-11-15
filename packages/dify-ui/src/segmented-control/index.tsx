'use client'

import { Radio as BaseRadio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import * as React from 'react'
import { cn } from '../cn'
import { focusRingClassName } from '../internal/focus'
import { resolveClassName } from '../internal/resolve-class-name'

type SegmentedControlSelectionProps<Value> =
  | {
      value: Value
      defaultValue?: never
    }
  | {
      value?: never
      defaultValue: Value
    }

type SegmentedControlProps<Value = string> = Omit<
  BaseRadioGroup.Props<Value>,
  'defaultValue' | 'value'
> &
  SegmentedControlSelectionProps<Value>

function SelectionThumb() {
  const ref = React.useRef<HTMLSpanElement>(null)

  React.useLayoutEffect(() => {
    const thumb = ref.current!
    const group = thumb.parentElement!
    const getSelected = () => group.querySelector<HTMLElement>('[role="radio"][data-checked]')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let selected = getSelected()
    let slide: Animation | undefined
    let hideFill: Animation | undefined

    function stop() {
      if (slide) {
        slide.onfinish = null
        slide.cancel()
      }
      hideFill?.cancel()
      slide = undefined
      thumb.hidden = true
    }

    function update() {
      const next = getSelected()
      if (next === selected) return
      const from = (slide ? thumb : selected)?.getBoundingClientRect()
      selected = next
      stop()
      if (!next || !from?.width || reducedMotion.matches || next.matches(':focus-visible')) return

      const to = next.getBoundingClientRect()
      if (!to.width || !to.height) return

      // Paint the item's actual surface during the slide. Its layout and focus ring stay in place.
      const surface = getComputedStyle(next)
      Object.assign(thumb.style, {
        width: surface.width,
        height: surface.height,
        backgroundColor: surface.backgroundColor,
        border: surface.border,
        borderRadius: surface.borderRadius,
        boxShadow: surface.getPropertyValue('--tw-shadow'),
      })
      thumb.hidden = false
      const origin = thumb.getBoundingClientRect()
      const scaleX = origin.width / Number.parseFloat(surface.width)
      const scaleY = origin.height / Number.parseFloat(surface.height)
      const transform = (rect: DOMRect) =>
        `translate(${(rect.x - origin.x) / scaleX}px, ${(rect.y - origin.y) / scaleY}px) scale(${rect.width / origin.width}, ${rect.height / origin.height})`

      const timing: KeyframeAnimationOptions = {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'both',
      }
      const clear = {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        '--tw-shadow': '0 0 #0000',
      }
      hideFill = next.animate([clear, clear], timing)
      slide = thumb.animate([{ transform: transform(from) }, { transform: transform(to) }], timing)
      slide.onfinish = stop
    }

    const observer = new MutationObserver(update)
    observer.observe(group, {
      attributes: true,
      attributeFilter: ['data-checked'],
      childList: true,
      subtree: true,
    })
    reducedMotion.addEventListener('change', stop)
    return () => {
      observer.disconnect()
      reducedMotion.removeEventListener('change', stop)
      stop()
    }
  }, [])

  return (
    <span
      ref={ref}
      hidden
      aria-hidden="true"
      className="pointer-events-none absolute inset-s-0 top-0 origin-top-left"
    />
  )
}

function SegmentedControl<Value = string>({
  children,
  className,
  ...props
}: SegmentedControlProps<Value>) {
  return (
    <BaseRadioGroup<Value>
      className={(state) =>
        cn(
          'relative isolate inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      <SelectionThumb />
      {children}
    </BaseRadioGroup>
  )
}

type SegmentedControlItemProps<Value = string> = BaseRadio.Root.Props<Value>

function SegmentedControlItem<Value = string>({
  className,
  nativeButton = true,
  render = <button type="button" />,
  ...props
}: SegmentedControlItemProps<Value>) {
  return (
    <BaseRadio.Root<Value>
      nativeButton={nativeButton}
      render={render}
      className={(state) =>
        cn(
          focusRingClassName,
          'relative flex h-7 min-w-0 touch-manipulation items-center justify-center gap-0.5 overflow-hidden rounded-lg border-[0.5px] border-transparent px-2 py-1 system-sm-medium whitespace-nowrap text-text-secondary hover:bg-state-base-hover hover:text-text-secondary data-checked:border-components-segmented-control-item-active-border data-checked:bg-components-segmented-control-item-active-bg data-checked:text-text-accent-light-mode-only data-checked:shadow-xs data-checked:shadow-shadow-shadow-3 data-disabled:cursor-not-allowed data-disabled:bg-transparent data-disabled:text-text-disabled data-disabled:shadow-none data-disabled:hover:bg-transparent data-disabled:hover:text-text-disabled',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type SegmentedControlDividerProps = React.ComponentProps<'span'>

function SegmentedControlDivider({ className, ...props }: SegmentedControlDividerProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-3.5 w-px shrink-0 bg-divider-regular has-[+_[data-checked]]:invisible [input:checked+&]:invisible',
        className,
      )}
      {...props}
    />
  )
}

export { SegmentedControl, SegmentedControlDivider, SegmentedControlItem }

export type { SegmentedControlDividerProps, SegmentedControlItemProps, SegmentedControlProps }
