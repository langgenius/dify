'use client'

import { Fieldset as BaseFieldset } from '@base-ui/react/fieldset'
import { cn } from '../cn'
import { resolveClassName } from '../internal/resolve-class-name'

type FieldsetProps = BaseFieldset.Root.Props

function Fieldset({ className, ...props }: FieldsetProps) {
  return (
    <BaseFieldset.Root
      className={(state) => cn('m-0 min-w-0 border-0 p-0', resolveClassName(className, state))}
      {...props}
    />
  )
}

type FieldsetLegendProps = BaseFieldset.Legend.Props

function FieldsetLegend({ className, ...props }: FieldsetLegendProps) {
  return (
    <BaseFieldset.Legend
      className={(state) =>
        cn('mb-1 py-1 system-sm-medium text-text-secondary', resolveClassName(className, state))
      }
      {...props}
    />
  )
}

export { Fieldset, FieldsetLegend }

export type { FieldsetLegendProps, FieldsetProps }
