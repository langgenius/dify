import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { type Node, useStoreApi } from 'reactflow'
import Button from '@/app/components/base/button'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import { StopCircle } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { useStore } from '../store'
import { useToolIcon } from '@/app/components/workflow/hooks/use-tool-icon'
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
  const triggerType = listeningTriggerType || BlockEnum.TriggerWebhook

  // Get the trigger node data to extract icon information
  const { getNodes } = store.getState()
  const nodes = getNodes()
  const triggerNode = listeningTriggerNodeId
    ? nodes.find(node => node.id === listeningTriggerNodeId)
    : undefined

  // Use the useToolIcon hook to get the icon for plugin/datasource triggers
  const toolIcon = useToolIcon(triggerNode?.data)
  const description = resolveListeningDescription(message, triggerNode, t)

  return (
    <div className='flex h-full flex-col gap-4 rounded-xl bg-background-section p-8'>
      <BlockIcon type={triggerType} toolIcon={toolIcon} size="md" className="!h-10 !w-10 !rounded-xl [&_svg]:!h-7 [&_svg]:!w-7" />
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
