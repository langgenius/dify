import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCrosshairLine } from '@remixicon/react'
import { useReactFlow, useStoreApi } from 'reactflow'
import TooltipPlus from '@/app/components/base/tooltip'

type NodePositionProps = {
  nodeId: string
}
const NodePosition = ({
  nodeId,
}: NodePositionProps) => {
  const { t } = useTranslation()
  const reactflow = useReactFlow()
  const store = useStoreApi()

  if (!nodeId) return null

  const node = reactflow.getNode(nodeId)
  if (node == null) return null

  const workflowContainer = document.getElementById('workflow-container')
  const { transform } = store.getState()
  const zoom = transform[2]

  const { clientWidth, clientHeight } = workflowContainer!
  const { setViewport } = reactflow
  const position = node.position

  return (
    <TooltipPlus
      popupContent={t('workflow.panel.moveToThisNode')}
    >
      <div
        className='mr-1 flex h-6 w-6 cursor-pointer items-center justify-center  rounded-md hover:bg-state-base-hover'
        onClick={() => {
          setViewport({
            x: (clientWidth - 400 - node.width! * zoom) / 2 - position.x * zoom,
            y: (clientHeight - node.height! * zoom) / 2 - position.y * zoom,
            zoom: transform[2],
          })
        }}
      >
        <RiCrosshairLine className='h-4 w-4 text-text-tertiary' />
      </div>
    </TooltipPlus>
  )
}

export default memo(NodePosition)
