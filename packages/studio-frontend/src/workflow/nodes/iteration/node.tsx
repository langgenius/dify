import type { FC } from 'react'
import type { IterationNodeType } from '@/app/components/workflow/nodes/iteration/types'
import type { NodeProps } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import {
  memo,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Background,
  useNodesInitialized,
  useViewport,
} from 'reactflow'
import { IterationStartNodeDumb } from '@/app/components/workflow/nodes/iteration-start/index'
import AddBlock from '@/app/components/workflow/nodes/iteration/add-block'
import { useNodeIterationInteractions } from '@/app/components/workflow/nodes/iteration/use-interactions'

const i18nPrefix = 'nodes.iteration'

const Node: FC<NodeProps<IterationNodeType>> = ({
  id,
  data,
}) => {
  const { zoom } = useViewport()
  const nodesInitialized = useNodesInitialized()
  const { handleNodeIterationRerender } = useNodeIterationInteractions()
  const { t } = useTranslation()
  const [showTips, setShowTips] = useState(data._isShowTips)

  useEffect(() => {
    if (nodesInitialized)
      handleNodeIterationRerender(id)
    if (data.is_parallel && showTips) {
      toast.warning(t(`${i18nPrefix}.answerNodeWarningDesc`, { ns: 'workflow' }))
      setShowTips(false)
    }
  }, [nodesInitialized, id, handleNodeIterationRerender, data.is_parallel, showTips, t])

  return (
    <div className={cn(
      'relative h-full min-h-[90px] w-full min-w-[240px] rounded-2xl bg-workflow-canvas-workflow-bg',
    )}
    >
      <Background
        id={`iteration-background-${id}`}
        className="z-0! rounded-2xl"
        gap={[14 / zoom, 14 / zoom]}
        size={2 / zoom}
        color="var(--color-workflow-canvas-workflow-dot-color)"
      />
      {
        data._isCandidate && (
          <IterationStartNodeDumb />
        )
      }
      {
        data._children?.length === 1 && (
          <AddBlock
            iterationNodeId={id}
            iterationNodeData={data}
          />
        )
      }
    </div>
  )
}

export default memo(Node)
