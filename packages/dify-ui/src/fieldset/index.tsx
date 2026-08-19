'use client'

import type { Fieldset as BaseFieldsetNS } from '@base-ui/react/fieldset'
import { Fieldset as BaseFieldset } from '@base-ui/react/fieldset'
import { cn } from '../cn'

type FieldsetProps = Omit<BaseFieldsetNS.Root.Props, 'className'> & {
  className?: string
}

function Fieldset({ className, ...props }: FieldsetProps) {
  return <BaseFieldset.Root className={cn('m-0 min-w-0 border-0 p-0', className)} {...props} />
}

type FieldsetLegendProps = Omit<BaseFieldsetNS.Legend.Props, 'className'> & {
  className?: string
}

function FieldsetLegend({ className, ...props }: FieldsetLegendProps) {
  return (
    <BaseFieldset.Legend
      className={cn('mb-1 py-1 system-sm-medium text-text-secondary', className)}
      {...props}
    />
  )
}

export { Fieldset, FieldsetLegend }

export type { FieldsetLegendProps, FieldsetProps }
