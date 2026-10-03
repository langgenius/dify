'use client'
import { Field, FieldDescription, FieldLabel } from '@langgenius/dify-ui/field'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'

export type MCPServerParam = {
  variable?: string
  label?: string
  type?: string
}

type Props = Readonly<{
  data: MCPServerParam
  value: string
  onChange: (value: string) => void
}>

const MCPServerParamItem = ({ data, value, onChange }: Props) => {
  const { t } = useTranslation(['tools'])

  return (
    <Field name={`parameter-${data.variable}`} className="min-w-0 gap-0.5">
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2">
        <FieldLabel className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-secondary">
          {data.label || data.variable}
        </FieldLabel>
        <FieldDescription className="flex min-w-0 flex-wrap items-center gap-2 p-0">
          <span aria-hidden className="system-xs-medium text-text-quaternary">
            ·
          </span>
          <span className="max-w-full min-w-0 system-xs-medium break-all text-text-secondary">
            {data.variable}
          </span>
          <span className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-tertiary">
            {data.type}
          </span>
        </FieldDescription>
      </div>
      <Textarea
        className="h-8 resize-none"
        value={value}
        placeholder={t(($) => $['mcp.server.modal.parametersPlaceholder'], { ns: 'tools' })}
        onValueChange={(value) => onChange(value)}
      />
    </Field>
  )
}

export default MCPServerParamItem
