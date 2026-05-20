'use client'

import type { Form as BaseFormNS } from '@base-ui/react/form'
import { Form as BaseForm } from '@base-ui/react/form'

export const Form = BaseForm

export type FormProps = BaseFormNS.Props
export type FormActions = BaseFormNS.Actions
export type FormValidationMode = BaseFormNS.ValidationMode
export type FormSubmitEventDetails = BaseFormNS.SubmitEventDetails
