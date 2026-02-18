'use client'
import type { FC } from 'react'
import type { TriggerMetadata } from '@/models/log'
import * as React from 'react'
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
import useTheme from '@/hooks/use-theme'
import { WorkflowRunTriggeredFrom } from '@/models/log'
import { Theme } from '@/types/app'

type TriggerByDisplayProps = {
  triggeredFrom: WorkflowRunTriggeredFrom
  className?: string
  showText?: boolean
  triggerMetadata?: TriggerMetadata
}

const getTriggerDisplayName = (triggeredFrom: WorkflowRunTriggeredFrom, t: any, metadata?: TriggerMetadata) => {
  if (triggeredFrom === WorkflowRunTriggeredFrom.PLUGIN && metadata?.event_name)
    return metadata.event_name

  const nameMap: Record<WorkflowRunTriggeredFrom, string> = {
    'debugging': t('triggerBy.debugging', { ns: 'appLog' }),
    'app-run': t('triggerBy.appRun', { ns: 'appLog' }),
    'webhook': t('triggerBy.webhook', { ns: 'appLog' }),
    'schedule': t('triggerBy.schedule', { ns: 'appLog' }),
    'plugin': t('triggerBy.plugin', { ns: 'appLog' }),
    'rag-pipeline-run': t('triggerBy.ragPipelineRun', { ns: 'appLog' }),
    'rag-pipeline-debugging': t('triggerBy.ragPipelineDebugging', { ns: 'appLog' }),
  }

  return nameMap[triggeredFrom] || triggeredFrom
}

const getPluginIcon = (metadata: TriggerMetadata | undefined, theme: Theme) => {
  if (!metadata)
    return null

  const icon = theme === Theme.dark
    ? metadata.icon_dark || metadata.icon
    : metadata.icon || metadata.icon_dark

  if (!icon)
    return null

  return (
    <BlockIcon
      type={BlockEnum.TriggerPlugin}
      size="md"
      toolIcon={icon}
    />
  )
}

const getTriggerIcon = (triggeredFrom: WorkflowRunTriggeredFrom, metadata: TriggerMetadata | undefined, theme: Theme) => {
  switch (triggeredFrom) {
    case 'webhook':
      return (
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 p-1 shadow-md">
          <WebhookLine className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )
    case 'schedule':
      return (
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-violet-violet-500 p-1 shadow-md">
          <Schedule className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )
    case 'plugin':
      return getPluginIcon(metadata, theme) || (
        <BlockIcon
          type={BlockEnum.TriggerPlugin}
          size="md"
        />
      )
    case 'debugging':
      return (
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-blue-500 p-1 shadow-md">
          <Code className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )
    case 'rag-pipeline-run':
    case 'rag-pipeline-debugging':
      return (
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-green-green-500 p-1 shadow-md">
          <KnowledgeRetrieval className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )
    case 'app-run':
    default:
      // For user input types (app-run, etc.), use webapp icon
      return (
        <div className="rounded-lg border-[0.5px] border-divider-subtle bg-util-colors-blue-brand-blue-brand-500 p-1 shadow-md">
          <WindowCursor className="h-4 w-4 text-text-primary-on-surface" />
        </div>
      )
  }
}

const TriggerByDisplay: FC<TriggerByDisplayProps> = ({
  triggeredFrom,
  className = '',
  showText = true,
  triggerMetadata,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()

  const displayName = getTriggerDisplayName(triggeredFrom, t, triggerMetadata)
  const icon = getTriggerIcon(triggeredFrom, triggerMetadata, theme)

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
