import {
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddLine,
} from '@remixicon/react'
import {
  useAvailableBlocks,
  useNodesInteractions,
  useNodesReadOnly,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import BlockSelector from '@/app/components/workflow/block-selector'
import type {
  CommonNodeType,
  OnSelectBlock,
} from '@/app/components/workflow/types'

type AddProps = {
  nodeId: string
  nodeData: CommonNodeType
  sourceHandle: string
  isParallel?: boolean
  isFailBranch?: boolean
}
const Add = ({
  nodeId,
  nodeData,
  sourceHandle,
  isParallel,
  isFailBranch,
}: AddProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { handleNodeAdd } = useNodesInteractions()
  const { nodesReadOnly } = useNodesReadOnly()
  const { availableNextBlocks } = useAvailableBlocks(nodeData.type, nodeData.isInIteration)
  const { checkParallelLimit } = useWorkflow()

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeAdd(
      {
        nodeType: type,
        toolDefaultValue,
      },
      {
        prevNodeId: nodeId,
        prevNodeSourceHandle: sourceHandle,
      },
    )
  }, [nodeId, sourceHandle, handleNodeAdd])

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen && !checkParallelLimit(nodeId, sourceHandle))
      return

    setOpen(newOpen)
  }, [checkParallelLimit, nodeId, sourceHandle])

  const tip = useMemo(() => {
    if (isFailBranch)
      return t('workflow.common.addFailureBranch')

    if (isParallel)
      return t('workflow.common.addParallelNode')

    return t('workflow.panel.selectNextStep')
  }, [isFailBranch, isParallel, t])
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <div
        className={`
          relative flex items-center px-2 h-9 rounded-lg border border-dashed border-divider-regular bg-dropzone-bg
          hover:bg-dropzone-bg-hover text-xs text-text-placeholder cursor-pointer
          ${open && '!bg-components-dropzone-bg-alt'}
          ${nodesReadOnly && '!cursor-not-allowed'}
        `}
      >
        <div className='flex items-center justify-center mr-1.5 w-5 h-5 rounded-[5px] bg-background-default-dimm'>
          <RiAddLine className='w-3 h-3' />
        </div>
        <div className='flex items-center uppercase'>
          {tip}
        </div>
      </div>
    )
  }, [nodesReadOnly, tip])

  return (
    <BlockSelector
      open={open}
      onOpenChange={handleOpenChange}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      placement='top'
      offset={0}
      trigger={renderTrigger}
      popupClassName='!w-[328px]'
      availableBlocksTypes={availableNextBlocks}
    />
  )
}

export default memo(Add)
