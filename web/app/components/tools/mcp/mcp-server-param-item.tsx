'use client'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Textarea from '@/app/components/base/textarea'

type Props = {
  data?: any
  value: string
  onChange: (value: string) => void
}

const MCPServerParamItem = ({
  data,
  value,
  onChange,
}: Props) => {
  const { t } = useTranslation()

  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2">
        <div className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-secondary">{data.label}</div>
        <div className="system-xs-medium text-text-quaternary">·</div>
        <div className="max-w-full min-w-0 system-xs-medium break-all text-text-secondary">{data.variable}</div>
        <div className="max-w-full min-w-0 system-xs-medium wrap-break-word text-text-tertiary">{data.type}</div>
      </div>
      <Textarea
        className="h-8 resize-none"
        value={value}
        placeholder={t('mcp.server.modal.parametersPlaceholder', { ns: 'tools' })}
        onChange={e => onChange(e.target.value)}
      >
      </Textarea>
    </div>
  )
}

export default MCPServerParamItem
