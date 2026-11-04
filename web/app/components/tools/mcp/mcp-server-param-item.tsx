'use client'
import { Textarea } from '@langgenius/dify-ui/textarea'
import * as React from 'react'
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
  const inputId = React.useId()

  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2">
        <label
          htmlFor={inputId}
          className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-secondary"
        >
          {data.label || data.variable}
        </label>
        <span aria-hidden className="system-xs-medium text-text-quaternary">
          ·
        </span>
        <div className="max-w-full min-w-0 system-xs-medium break-all text-text-secondary">
          {data.variable}
        </div>
        <div className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-tertiary">
          {data.type}
        </div>
      </div>
      <Textarea
        id={inputId}
        className="h-8 resize-none"
        value={value}
        placeholder={t(($) => $['mcp.server.modal.parametersPlaceholder'], { ns: 'tools' })}
        onValueChange={(value) => onChange(value)}
      />
    </div>
  )
}

export default MCPServerParamItem
