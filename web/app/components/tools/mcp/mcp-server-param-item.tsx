'use client'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'

export type MCPServerParam = {
  variable?: string
  label?: string
  type?: string
}

type Props = Readonly<{
  data: MCPServerParam
  readOnly?: boolean
  value: string
  onChange: (value: string) => void
}>

export function MCPServerParamItem({ data, value, onChange, readOnly }: Props) {
  const { t } = useTranslation(['tools'])

  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2">
        <div className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-secondary">
          {data.label}
        </div>
        <div className="system-xs-medium text-text-quaternary">·</div>
        <div className="max-w-full min-w-0 system-xs-medium break-all text-text-secondary">
          {data.variable}
        </div>
        <div className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-tertiary">
          {data.type}
        </div>
      </div>
      <Textarea
        aria-label={data.label || data.variable}
        className="h-8 resize-none"
        value={value}
        readOnly={readOnly}
        placeholder={t(($) => $['mcp.server.modal.parametersPlaceholder'], { ns: 'tools' })}
        onValueChange={(value) => onChange(value)}
      />
    </div>
  )
}
