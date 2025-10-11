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
  const { availableNextBlocks } = useAvailableBlocks(nodeData.type, nodeData.isInIteration || nodeData.isInLoop)

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
  }, [handleNodeAdd])

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
  }, [])

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
          bg-dropzone-bg hover:bg-dropzone-bg-hover relative flex h-9 cursor-pointer items-center rounded-lg border border-dashed
          border-divider-regular px-2 text-xs text-text-placeholder
          ${open && '!bg-components-dropzone-bg-alt'}
          ${nodesReadOnly && '!cursor-not-allowed'}
        `}
      >
        <div className='mr-1.5 flex h-5 w-5 items-center justify-center rounded-[5px] bg-background-default-dimmed'>
          <RiAddLine className='h-3 w-3' />
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
