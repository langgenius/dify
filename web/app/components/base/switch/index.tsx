'use client'

import type { VariantProps } from 'class-variance-authority'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/utils/classnames'

const switchRootVariants = cva(
  'group relative inline-flex shrink-0 items-center transition-colors duration-200 ease-in-out focus-visible:ring-2 focus-visible:ring-components-toggle-bg motion-reduce:transition-none',
  {
    variants: {
      size: {
        xs: 'h-2.5 w-3.5 rounded-[2px] p-0.5',
        sm: 'h-3 w-5 rounded-[3.5px] p-0.5',
        md: 'h-4 w-7 rounded-[5px] p-0.5',
        lg: 'h-5 w-9 rounded-[6px] p-[3px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

const switchThumbVariants = cva(
  'block transition-transform duration-200 ease-in-out motion-reduce:transition-none',
  {
    variants: {
      size: {
        xs: 'h-1.5 w-1 rounded-[1px]',
        sm: 'h-2 w-[7px] rounded-[2px]',
        md: 'h-3 w-2.5 rounded-[3px]',
        lg: 'size-3.5 rounded-[4px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

export type SwitchSize = NonNullable<VariantProps<typeof switchRootVariants>['size']>

const thumbCheckedTranslate: Record<SwitchSize, string> = {
  xs: 'translate-x-1.5',
  sm: 'translate-x-[9px]',
  md: 'translate-x-[14px]',
  lg: 'translate-x-4',
}

const spinnerSizeConfig: Partial<Record<SwitchSize, {
  icon: string
  uncheckedPosition: string
  checkedPosition: string
}>> = {
  md: {
    icon: 'size-2',
    uncheckedPosition: 'left-[calc(50%+6px)]',
    checkedPosition: 'left-[calc(50%-6px)]',
  },
  lg: {
    icon: 'size-2.5',
    uncheckedPosition: 'left-[calc(50%+8px)]',
    checkedPosition: 'left-[calc(50%-8px)]',
  },
}

type SwitchProps = {
  'value': boolean
  'onChange'?: (value: boolean) => void
  'size'?: SwitchSize
  'disabled'?: boolean
  'loading'?: boolean
  'className'?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'data-testid'?: string
}

const Switch = ({
  ref,
  value,
  onChange,
  size = 'md',
  disabled = false,
  loading = false,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'data-testid': dataTestid,
}: SwitchProps & {
  ref?: React.RefObject<HTMLButtonElement>
}) => {
  const isDisabled = disabled || loading
  const spinner = loading ? spinnerSizeConfig[size] : undefined

  return (
    <BaseSwitch.Root
      ref={ref}
      checked={value}
      onCheckedChange={checked => onChange?.(checked)}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={state => cn(
        switchRootVariants({ size }),
        state.disabled
          ? cn(
              'cursor-not-allowed',
              state.checked
                ? 'bg-components-toggle-bg-disabled'
                : 'bg-components-toggle-bg-unchecked-disabled',
            )
          : cn(
              'cursor-pointer',
              state.checked
                ? 'bg-components-toggle-bg hover:bg-components-toggle-bg-hover'
                : 'bg-components-toggle-bg-unchecked hover:bg-components-toggle-bg-unchecked-hover',
            ),
        className,
      )}
      data-testid={dataTestid}
    >
      <BaseSwitch.Thumb
        className={state => cn(
          switchThumbVariants({ size }),
          state.disabled
            ? 'bg-components-toggle-knob-disabled'
            : 'bg-components-toggle-knob shadow-sm group-hover:bg-components-toggle-knob-hover group-hover:shadow-md',
          state.checked ? thumbCheckedTranslate[size] : 'translate-x-0',
        )}
      />
      {spinner
        ? (
            <span
              className={cn(
                'absolute top-1/2 -translate-x-1/2 -translate-y-1/2',
                spinner.icon,
                value ? spinner.checkedPosition : spinner.uncheckedPosition,
              )}
              aria-hidden="true"
            >
              <i className="i-ri-loader-2-line size-full animate-spin text-text-tertiary motion-reduce:animate-none" />
            </span>
          )
        : null}
    </BaseSwitch.Root>
  )
}

Switch.displayName = 'Switch'

export default React.memo(Switch)
