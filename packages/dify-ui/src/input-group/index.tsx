'use client'

import type { Input as BaseInputNS } from '@base-ui/react/input'
import type { VariantProps } from 'class-variance-authority'
import { Input as BaseInput } from '@base-ui/react/input'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'

const interactiveElementSelector =
  'button,a[href],[role="button"],[role="link"],select,[tabindex]:not([tabindex="-1"]),input:not([type="hidden"]):not([disabled]),[contenteditable]:not([contenteditable="false"]),textarea:not([disabled])'

type InputGroupProps = React.ComponentProps<'div'>

function InputGroup({ className, onMouseDown, ...props }: InputGroupProps) {
  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- The handler extends the native input's pointer target; keyboard users reach the input directly.
    <div
      {...props}
      className={cn(
        [
          'flex min-h-8 w-full min-w-0 items-center rounded-lg border border-transparent bg-components-input-bg-normal transition-[background-color,border-color,box-shadow]',
          'has-[>input:enabled]:not-has-[>input[readonly]]:hover:border-components-input-border-hover has-[>input:enabled]:not-has-[>input[readonly]]:hover:bg-components-input-bg-hover',
          'has-[>input:focus]:not-has-[>input[readonly]]:border-components-input-border-active has-[>input:focus]:not-has-[>input[readonly]]:bg-components-input-bg-active has-[>input:focus]:not-has-[>input[readonly]]:shadow-xs',
          'has-[>input[data-invalid]]:border-components-input-border-destructive has-[>input[data-invalid]]:bg-components-input-bg-destructive',
          'has-[>input[data-disabled]]:cursor-not-allowed has-[>input[data-disabled]]:border-transparent has-[>input[data-disabled]]:bg-components-input-bg-disabled has-[>input[data-disabled]]:text-components-input-text-filled-disabled',
          'has-[>input[data-disabled]]:*:data-align:cursor-not-allowed has-[>input[data-disabled]]:*:data-align:text-components-input-text-filled-disabled',
          'has-[>input[readonly]]:cursor-default has-[>input[readonly]]:*:data-align:cursor-default',
          'has-[>input[readonly]:focus-visible]:ring-2 has-[>input[readonly]:focus-visible]:ring-state-accent-solid',
          'has-[>[data-align=inline-start]]:[&>input]:ps-0',
          'has-[>[data-align=inline-end]]:[&>input]:pe-0',
          'motion-reduce:transition-none',
        ],
        className,
      )}
      onMouseDown={(event) => {
        onMouseDown?.(event)
        if (event.defaultPrevented || event.button !== 0) return

        const eventPath = event.nativeEvent.composedPath()
        if (!eventPath.includes(event.currentTarget)) return

        const target = eventPath[0]
        const ElementConstructor = event.currentTarget.ownerDocument.defaultView?.Element
        if (!ElementConstructor || !(target instanceof ElementConstructor)) return
        if (target !== event.currentTarget && target.closest(interactiveElementSelector)) return

        const input = event.currentTarget.querySelector<HTMLInputElement>(':scope > input')
        if (!input || input.disabled) return

        event.preventDefault()
        input.focus()
      }}
    />
  )
}

type InputGroupInputProps = Omit<BaseInputNS.Props, 'className' | 'render' | 'size'> & {
  className?: string
}

function InputGroupInput({ className, ...props }: InputGroupInputProps) {
  return (
    <BaseInput
      {...props}
      className={cn(
        [
          'w-0 min-w-0 flex-1 appearance-none rounded-none border-0 bg-transparent px-3 py-1.75 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden',
          'placeholder:text-components-input-text-placeholder',
          'read-only:cursor-default',
          'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled',
        ],
        className,
      )}
    />
  )
}

const inputGroupAddonVariants = cva(
  'flex shrink-0 cursor-text items-center self-stretch system-sm-regular text-text-secondary select-none',
  {
    variants: {
      align: {
        'inline-start': 'order-first ps-2 pe-1',
        'inline-end': 'order-last ps-1 pe-2',
      },
    },
    defaultVariants: {
      align: 'inline-start',
    },
  },
)

type InputGroupAddonProps = Omit<React.ComponentPropsWithRef<'div'>, 'className'> &
  VariantProps<typeof inputGroupAddonVariants> & {
    className?: string
  }

function InputGroupAddon({ align = 'inline-start', className, ...props }: InputGroupAddonProps) {
  return (
    <div
      {...props}
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
    />
  )
}

export { InputGroup, InputGroupAddon, InputGroupInput }
export type { InputGroupAddonProps, InputGroupInputProps, InputGroupProps }
