import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'
import { focusRingClassName } from './focus'

export const selectTriggerVariants = cva(
  [
    'group/select-trigger flex w-full items-center border-0 bg-components-input-bg-normal text-start text-components-input-text-filled',
    'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt data-popup-open:bg-state-base-hover-alt',
    focusRingClassName,
    'data-invalid:not-data-disabled:bg-components-input-bg-destructive data-invalid:not-data-disabled:inset-ring-1 data-invalid:not-data-disabled:inset-ring-components-input-border-destructive',
    'data-placeholder:text-components-input-text-placeholder',
    'data-readonly:not-data-disabled:cursor-default data-readonly:not-data-disabled:not-data-invalid:bg-components-input-bg-normal data-readonly:not-data-disabled:not-data-invalid:hover:bg-components-input-bg-normal',
    'data-disabled:cursor-not-allowed data-disabled:bg-components-input-bg-disabled data-disabled:text-components-input-text-filled-disabled data-disabled:hover:bg-components-input-bg-disabled',
    'data-disabled:data-placeholder:text-components-input-text-disabled',
  ],
  {
    variants: {
      size: {
        // The text sits 4px further in than the icon: 8px around the control, 4px more for text.
        small: 'h-6 gap-px rounded-md py-1 ps-2 pe-1 system-xs-regular',
        medium: 'h-8 gap-0.5 rounded-lg py-2 ps-3 pe-2 system-sm-regular',
        large: 'h-9 gap-0.5 rounded-[10px] py-2 ps-4 pe-3 system-md-regular',
      },
    },
    defaultVariants: {
      size: 'medium',
    },
  },
)

export type SelectSize = NonNullable<VariantProps<typeof selectTriggerVariants>['size']>

export const selectTriggerIconClassName =
  'shrink-0 text-text-quaternary group-[:hover:not([data-disabled],[data-readonly])]/select-trigger:text-text-secondary data-popup-open:text-text-secondary'
