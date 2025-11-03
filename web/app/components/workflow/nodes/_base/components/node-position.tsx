import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { RiCrosshairLine } from '@remixicon/react'
import { useReactFlow, useStore } from 'reactflow'
import TooltipPlus from '@/app/components/base/tooltip'
import { useNodesSyncDraft } from '@/app/components/workflow-app/hooks'

type NodePositionProps = {
  nodeId: string
}
const NodePosition = ({
  nodeId,
}: NodePositionProps) => {
  const { t } = useTranslation()
  const reactflow = useReactFlow()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const {
    nodePosition,
    nodeWidth,
    nodeHeight,
  } = useStore(useShallow((s) => {
    const nodes = s.getNodes()
    const currentNode = nodes.find(node => node.id === nodeId)!

    return {
      nodePosition: currentNode.position,
      nodeWidth: currentNode.width,
      nodeHeight: currentNode.height,
    }
  }))
  const transform = useStore(s => s.transform)

  if (!nodePosition || !nodeWidth || !nodeHeight) return null

  const workflowContainer = document.getElementById('workflow-container')
  const zoom = transform[2]

  const { clientWidth, clientHeight } = workflowContainer!
  const { setViewport } = reactflow

  return (
    <TooltipPlus
      popupContent={t('workflow.panel.moveToThisNode')}
    >
      <div
        className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover'
        onClick={() => {
          setViewport({
            x: (clientWidth - 400 - nodeWidth * zoom) / 2 - nodePosition.x * zoom,
            y: (clientHeight - nodeHeight * zoom) / 2 - nodePosition.y * zoom,
            zoom: transform[2],
          })
          doSyncWorkflowDraft()
        }}
      >
        <RiCrosshairLine className='h-4 w-4 text-text-tertiary' />
      </div>
    </TooltipPlus>
  )
}

export default memo(NodePosition)
