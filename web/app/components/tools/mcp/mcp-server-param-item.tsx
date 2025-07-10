'use client'
import React from 'react'
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
    <div className='space-y-0.5'>
      <div className='flex h-6 items-center gap-2'>
        <div className='system-xs-medium text-text-secondary'>{data.label}</div>
        <div className='system-xs-medium text-text-quaternary'>·</div>
        <div className='system-xs-medium text-text-secondary'>{data.variable}</div>
        <div className='system-xs-medium text-text-tertiary'>{data.type}</div>
      </div>
      <Textarea
        className='h-8 resize-none'
        value={value}
        placeholder={t('tools.mcp.server.modal.parametersPlaceholder')}
        onChange={e => onChange(e.target.value)}
      ></Textarea>
    </div>
  )
}

export default MCPServerParamItem
