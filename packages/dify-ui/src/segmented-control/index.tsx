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

  React.useEffect(() => {
    const thumb = ref.current!
    let painted: HTMLElement | null = null

    function clearSurface() {
      painted?.removeAttribute('data-dify-segment-sliding')
      painted = null
      thumb.style.visibility = ''
    }

    function start() {
      const selected = thumb.parentElement?.querySelector<HTMLElement>(
        '[role="radio"][data-checked]',
      )
      if (!selected || selected === painted) return
      clearSurface()
      // Callers style the checked radio. Borrow only its surface while CSS moves the thumb.
      const style = getComputedStyle(selected)
      Object.assign(thumb.style, {
        backgroundColor: style.backgroundColor,
        border: style.border,
        borderRadius: style.borderRadius,
        boxShadow: style.getPropertyValue('--tw-shadow'),
        visibility: 'visible',
      })
      painted = selected
      painted.setAttribute('data-dify-segment-sliding', '')
    }

    function finish() {
      if (thumb.getAnimations().length === 0) clearSurface()
    }

    thumb.addEventListener('transitionrun', start)
    thumb.addEventListener('transitionend', finish)
    thumb.addEventListener('transitioncancel', finish)
    return () => {
      thumb.removeEventListener('transitionrun', start)
      thumb.removeEventListener('transitionend', finish)
      thumb.removeEventListener('transitioncancel', finish)
      clearSurface()
    }
  }, [])

  return <span ref={ref} data-dify-segment-thumb="" aria-hidden="true" />
}

function SegmentedControl<Value = string>({
  children,
  className,
  ...props
}: SegmentedControlProps<Value>) {
  return (
    <BaseRadioGroup<Value>
      data-dify-segmented-control=""
      className={(state) =>
        cn(
          'relative isolate inline-flex items-center gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5',
          resolveClassName(className, state),
        )
      }
      {...props}
    >
      {children}
      <SelectionThumb />
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
