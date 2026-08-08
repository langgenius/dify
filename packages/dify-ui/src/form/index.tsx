'use client'

import type { Form as BaseFormNS } from '@base-ui/react/form'
import { Form as BaseForm } from '@base-ui/react/form'

const Form = BaseForm

type FormProps<FormValues extends BaseFormNS.Values = BaseFormNS.Values> =
  BaseFormNS.Props<FormValues>

export { Form }
export type { FormProps }
