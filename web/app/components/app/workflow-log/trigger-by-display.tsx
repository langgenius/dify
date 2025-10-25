'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Code,
  KnowledgeRetrieval,
  Schedule,
  WebhookLine,
  WindowCursor,
} from '@/app/components/base/icons/src/vender/workflow'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import type { TriggerInfo } from '@/models/log'

type TriggerByDisplayProps = {
  triggeredFrom: string
  className?: string
  showText?: boolean
  triggerInfo?: TriggerInfo
}

const resolveTriggerType = (value: string) => {
  switch (value) {
    case 'trigger-plugin':
      return 'plugin'
    case 'trigger-webhook':
      return 'webhook'
    case 'trigger-schedule':
      return 'schedule'
    default:
      return value
  }
}

const getTriggerDisplayName = (triggeredFrom: string, t: any) => {
  const nameMap: Record<string, string> = {
    'debugging': t('appLog.triggerBy.debugging'),
    'app-run': t('appLog.triggerBy.appRun'),
    'webhook': t('appLog.triggerBy.webhook'),
    'schedule': t('appLog.triggerBy.schedule'),
    'plugin': t('appLog.triggerBy.plugin'),
    'rag-pipeline-run': t('appLog.triggerBy.ragPipelineRun'),
    'rag-pipeline-debugging': t('appLog.triggerBy.ragPipelineDebugging'),
  }

  return nameMap[triggeredFrom] || triggeredFrom
}

const getTriggerIcon = (triggeredFrom: string, triggerInfo?: TriggerInfo) => {
  switch (triggeredFrom) {
    case 'webhook':
      return (
        <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 p-1 shadow-md'>
          <WebhookLine className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      )
    case 'schedule':
      return (
        <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-500 p-1 shadow-md'>
          <Schedule className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      )
    case 'plugin':
      return (
        <BlockIcon
          type={BlockEnum.TriggerPlugin}
          size="md"
          toolIcon={triggerInfo?.icon}
        />
      )
    case 'debugging':
      return (
        <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 p-1 shadow-md'>
          <Code className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      )
    case 'rag-pipeline-run':
    case 'rag-pipeline-debugging':
      return (
        <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-1 shadow-md'>
          <KnowledgeRetrieval className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      )
    case 'app-run':
    default:
      // For user input types (app-run, etc.), use webapp icon
      return (
        <div className='rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 p-1 shadow-md'>
          <WindowCursor className='h-4 w-4 text-text-primary-on-surface' />
        </div>
      )
  }
}

const pickLabel = (labelMap?: Record<string, string>, language?: string) => {
  if (!labelMap)
    return ''

  const candidates: string[] = []
  if (language) {
    candidates.push(language)
    const underscored = language.replace('-', '_')
    candidates.push(underscored)
    const parts = underscored.split('_')
    if (parts.length > 1)
      candidates.push(`${parts[0]}_${parts[1].toUpperCase()}`)
    candidates.push(parts[0])
  }
  candidates.push('en_US', 'en-US', 'en')

  for (const key of candidates) {
    if (key && labelMap[key])
      return labelMap[key]
  }

  const firstValue = Object.values(labelMap)[0]
  return firstValue || ''
}

const TriggerByDisplay: FC<TriggerByDisplayProps> = ({
  triggeredFrom,
  className = '',
  showText = true,
  triggerInfo,
}) => {
  const { t, i18n } = useTranslation()

  const resolvedType = resolveTriggerType(triggerInfo?.type || triggeredFrom)
  const providerDisplayName = pickLabel(triggerInfo?.provider_label, i18n.language)
    || triggerInfo?.provider_name
  const displayName = providerDisplayName || getTriggerDisplayName(resolvedType, t)
  const icon = getTriggerIcon(resolvedType, triggerInfo)

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <div className="flex items-center justify-center">
        {icon}
      </div>
      {showText && (
        <span className="system-sm-regular text-text-secondary">
          {displayName}
        </span>
      )}
    </div>
  )
}

export default TriggerByDisplay
