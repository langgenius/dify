'use client'

import type { Form as BaseFormNS } from '@base-ui/react/form'
import { Form as BaseForm } from '@base-ui/react/form'
import { cn } from '../cn'

export type FormProps<FormValues extends Record<string, unknown> = Record<string, unknown>>
  = Omit<BaseFormNS.Props<FormValues>, 'className'>
    & {
      className?: string
    }

export type FormActions = BaseFormNS.Actions
export type FormValidationMode = BaseFormNS.ValidationMode
export type FormSubmitEventDetails = BaseFormNS.SubmitEventDetails

export function Form<FormValues extends Record<string, unknown> = Record<string, unknown>>({
  className,
  ...props
}: FormProps<FormValues>) {
  return (
    <BaseForm
      className={cn(className)}
      {...props}
    />
  )
}
