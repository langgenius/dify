import type { TFunction } from 'i18next'
import type { FC } from 'react'
import type { Node } from 'reactflow'
import type { ScheduleTriggerNodeType } from '@/app/components/workflow/nodes/trigger-schedule/types'
import type { WebhookTriggerNodeType } from '@/app/components/workflow/nodes/trigger-webhook/types'
import copy from 'copy-to-clipboard'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import Button from '@/app/components/base/button'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import Tooltip from '@/app/components/base/tooltip'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useGetToolIcon } from '@/app/components/workflow/hooks/use-tool-icon'
import { getNextExecutionTime } from '@/app/components/workflow/nodes/trigger-schedule/utils/execution-time-calculator'
import { BlockEnum } from '@/app/components/workflow/types'
import { useStore } from '../store'

const resolveListeningDescription = (
  message: string | undefined,
  triggerNode: Node | undefined,
  triggerType: BlockEnum,
  t: TFunction,
): string => {
  if (message)
    return message

  if (triggerType === BlockEnum.TriggerSchedule) {
    const scheduleData = triggerNode?.data as ScheduleTriggerNodeType | undefined
    const nextTriggerTime = scheduleData ? getNextExecutionTime(scheduleData) : ''
    return t('debug.variableInspect.listening.tipSchedule', {
      ns: 'workflow',
      nextTriggerTime: nextTriggerTime || t('debug.variableInspect.listening.defaultScheduleTime', { ns: 'workflow' }),
    })
  }

  if (triggerType === BlockEnum.TriggerPlugin) {
    const pluginName = (triggerNode?.data as { provider_name?: string, title?: string })?.provider_name
      || (triggerNode?.data as { title?: string })?.title
      || t('debug.variableInspect.listening.defaultPluginName', { ns: 'workflow' })
    return t('debug.variableInspect.listening.tipPlugin', { ns: 'workflow', pluginName })
  }

  if (triggerType === BlockEnum.TriggerWebhook) {
    const nodeName = (triggerNode?.data as { title?: string })?.title || t('debug.variableInspect.listening.defaultNodeName', { ns: 'workflow' })
    return t('debug.variableInspect.listening.tip', { ns: 'workflow', nodeName })
  }

  const nodeDescription = (triggerNode?.data as { desc?: string })?.desc
  if (nodeDescription)
    return nodeDescription

  return t('debug.variableInspect.listening.tipFallback', { ns: 'workflow' })
}

const resolveMultipleListeningDescription = (
  nodes: Node[],
  t: TFunction,
): string => {
  if (!nodes.length)
    return t('debug.variableInspect.listening.tipFallback', { ns: 'workflow' })

  const titles = nodes
    .map(node => (node.data as { title?: string })?.title)
    .filter((title): title is string => Boolean(title))

  if (titles.length)
    return t('debug.variableInspect.listening.tip', { ns: 'workflow', nodeName: titles.join(', ') })

  return t('debug.variableInspect.listening.tipFallback', { ns: 'workflow' })
}

export type ListeningProps = {
  onStop: () => void
  message?: string
}

const Listening: FC<ListeningProps> = ({
  onStop,
  message,
}) => {
  const { t } = useTranslation()
  const store = useStoreApi()

  // Get the current trigger type and node ID from store
  const listeningTriggerType = useStore(s => s.listeningTriggerType)
  const listeningTriggerNodeId = useStore(s => s.listeningTriggerNodeId)
  const listeningTriggerNodeIds = useStore(s => s.listeningTriggerNodeIds)
  const listeningTriggerIsAll = useStore(s => s.listeningTriggerIsAll)

  const getToolIcon = useGetToolIcon()

  // Get the trigger node data to extract icon information
  const { getNodes } = store.getState()
  const nodes = getNodes()
  const triggerNode = listeningTriggerNodeId
    ? nodes.find(node => node.id === listeningTriggerNodeId)
    : undefined
  const inferredTriggerType = (triggerNode?.data as { type?: BlockEnum })?.type
  const triggerType = listeningTriggerType || inferredTriggerType || BlockEnum.TriggerWebhook
  const webhookDebugUrl = triggerType === BlockEnum.TriggerWebhook
    ? (triggerNode?.data as WebhookTriggerNodeType | undefined)?.webhook_debug_url
    : undefined
  const [debugUrlCopied, setDebugUrlCopied] = useState(false)

  useEffect(() => {
    if (!debugUrlCopied)
      return

    const timer = window.setTimeout(() => {
      setDebugUrlCopied(false)
    }, 2000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [debugUrlCopied])

  let displayNodes: Node[] = []

  if (listeningTriggerIsAll) {
    if (listeningTriggerNodeIds.length > 0) {
      displayNodes = nodes.filter(node => listeningTriggerNodeIds.includes(node.id))
    }
    else {
      displayNodes = nodes.filter((node) => {
        const nodeType = (node.data as { type?: BlockEnum })?.type
        return nodeType === BlockEnum.TriggerSchedule
          || nodeType === BlockEnum.TriggerWebhook
          || nodeType === BlockEnum.TriggerPlugin
      })
    }
  }
  else if (triggerNode) {
    displayNodes = [triggerNode]
  }

  const iconsToRender = displayNodes.map((node) => {
    const blockType = (node.data as { type?: BlockEnum })?.type || BlockEnum.TriggerWebhook
    const icon = getToolIcon(node.data as any)
    return {
      key: node.id,
      type: blockType,
      toolIcon: icon,
    }
  })

  if (iconsToRender.length === 0) {
    iconsToRender.push({
      key: 'default',
      type: listeningTriggerIsAll ? BlockEnum.TriggerWebhook : triggerType,
      toolIcon: !listeningTriggerIsAll && triggerNode ? getToolIcon(triggerNode.data as any) : undefined,
    })
  }

  const description = listeningTriggerIsAll
    ? resolveMultipleListeningDescription(displayNodes, t)
    : resolveListeningDescription(message, triggerNode, triggerType, t)

  return (
    <div className="flex h-full flex-col gap-4 rounded-xl bg-background-section p-8">
      <div className="flex flex-row flex-wrap items-center gap-3">
        {iconsToRender.map(icon => (
          <BlockIcon
            key={icon.key}
            type={icon.type}
            toolIcon={icon.toolIcon}
            size="md"
            className="!h-10 !w-10 !rounded-xl [&_svg]:!h-7 [&_svg]:!w-7"
          />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <div className="system-sm-semibold text-text-secondary">{t('debug.variableInspect.listening.title', { ns: 'workflow' })}</div>
        <div className="system-xs-regular whitespace-pre-line text-text-tertiary">{description}</div>
      </div>
      {webhookDebugUrl && (
        <div className="flex items-center gap-2">
          <div className="system-xs-regular shrink-0 whitespace-pre-line text-text-tertiary">
            {t('nodes.triggerWebhook.debugUrlTitle', { ns: 'workflow' })}
          </div>
          <Tooltip
            popupContent={debugUrlCopied
              ? t('nodes.triggerWebhook.debugUrlCopied', { ns: 'workflow' })
              : t('nodes.triggerWebhook.debugUrlCopy', { ns: 'workflow' })}
            popupClassName="system-xs-regular text-text-primary bg-components-tooltip-bg border border-components-panel-border shadow-lg backdrop-blur-sm rounded-md px-1.5 py-1"
            position="top"
            offset={{ mainAxis: -4 }}
            needsDelay={true}
          >
            <button
              type="button"
              aria-label={t('nodes.triggerWebhook.debugUrlCopy', { ns: 'workflow' }) || ''}
              className={`inline-flex items-center rounded-[6px] border border-divider-regular bg-components-badge-white-to-dark px-1.5 py-[2px] font-mono text-[13px] leading-[18px] text-text-secondary transition-colors hover:bg-components-panel-on-panel-item-bg-hover focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-components-panel-border ${debugUrlCopied ? 'bg-components-panel-on-panel-item-bg-hover text-text-primary' : ''}`}
              onClick={() => {
                copy(webhookDebugUrl)
                setDebugUrlCopied(true)
              }}
            >
              <span className="whitespace-nowrap text-text-primary">
                {webhookDebugUrl}
              </span>
            </button>
          </Tooltip>
        </div>
      )}
      <div>
        <Button
          size="medium"
          className="px-3"
          variant="primary"
          onClick={onStop}
        >
          <StopCircle className="mr-1 size-4" />
          {t('debug.variableInspect.listening.stopButton', { ns: 'workflow' })}
        </Button>
      </div>
    </div>
  )
}

export default Listening
