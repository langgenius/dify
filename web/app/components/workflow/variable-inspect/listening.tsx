import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { type Node, useStoreApi } from 'reactflow'
import Button from '@/app/components/base/button'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useStore } from '../store'
import { useGetToolIcon } from '@/app/components/workflow/hooks/use-tool-icon'
import type { TFunction } from 'i18next'

const resolveListeningDescription = (
  message: string | undefined,
  triggerNode: Node | undefined,
  t: TFunction,
): string => {
  if (message)
    return message

  const nodeDescription = (triggerNode?.data as { desc?: string })?.desc
  if (nodeDescription)
    return nodeDescription

  return t('workflow.debug.variableInspect.listening.tip')
}

const resolveMultipleListeningDescription = (
  nodes: Node[],
  t: TFunction,
): string => {
  if (!nodes.length)
    return t('workflow.debug.variableInspect.listening.tip')

  const titles = nodes
    .map(node => (node.data as { title?: string })?.title)
    .filter((title): title is string => Boolean(title))

  if (titles.length)
    return titles.join(', ')

  return t('workflow.debug.variableInspect.listening.tip')
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
  const triggerType = listeningTriggerType || BlockEnum.TriggerWebhook

  const getToolIcon = useGetToolIcon()

  // Get the trigger node data to extract icon information
  const { getNodes } = store.getState()
  const nodes = getNodes()
  const triggerNode = listeningTriggerNodeId
    ? nodes.find(node => node.id === listeningTriggerNodeId)
    : undefined

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
    : resolveListeningDescription(message, triggerNode, t)

  return (
    <div className='flex h-full flex-col gap-4 rounded-xl bg-background-section p-8'>
      <div className='flex flex-row flex-wrap items-center gap-3'>
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
      <div className='flex flex-col gap-1'>
        <div className='system-sm-semibold text-text-secondary'>{t('workflow.debug.variableInspect.listening.title')}</div>
        <div className='system-xs-regular text-text-tertiary'>{description}</div>
      </div>
      <div>
        <Button
          size='medium'
          className='px-3'
          variant='primary'
          onClick={onStop}
        >
          <StopCircle className='mr-1 size-4' />
          {t('workflow.debug.variableInspect.listening.stopButton')}
        </Button>
      </div>
    </div>
  )
}

export default Listening
