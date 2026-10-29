'use client'

import { Form as BaseForm } from '@base-ui/react/form'

const Form = BaseForm

type FormActions = BaseForm.Actions
type FormSubmitEventReason = BaseForm.SubmitEventReason
type FormSubmitEventDetails = BaseForm.SubmitEventDetails

type FormProps<FormValues extends BaseForm.Values = BaseForm.Values> = BaseForm.Props<FormValues>

export { Form }
export type { FormActions, FormProps, FormSubmitEventDetails, FormSubmitEventReason }
