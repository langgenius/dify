import {
  memo,
  useCallback,
  useState,
} from 'react'
import { RiAddCircleFill } from '@remixicon/react'
import { useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import type { OffsetOptions } from '@floating-ui/react'
import {
  generateNewNode,
  getNodeCustomTypeByNodeDataType,
} from '../utils'
import {
  useAvailableBlocks,
  useNodesMetaData,
  useNodesReadOnly,
  usePanelInteractions,
} from '../hooks'
import { useWorkflowStore } from '../store'
import TipPopup from './tip-popup'
import cn from '@/utils/classnames'
import BlockSelector from '@/app/components/workflow/block-selector'
import type {
  OnSelectBlock,
} from '@/app/components/workflow/types'
import {
  BlockEnum,
} from '@/app/components/workflow/types'

type AddBlockProps = {
  renderTrigger?: (open: boolean) => React.ReactNode
  offset?: OffsetOptions
}
const AddBlock = ({
  renderTrigger,
  offset,
}: AddBlockProps) => {
  const { t } = useTranslation()
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { nodesReadOnly } = useNodesReadOnly()
  const { handlePaneContextmenuCancel } = usePanelInteractions()
  const [open, setOpen] = useState(false)
  const { availableNextBlocks } = useAvailableBlocks(BlockEnum.Start, false)
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open)
    if (!open)
      handlePaneContextmenuCancel()
  }, [handlePaneContextmenuCancel])

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    const {
      getNodes,
    } = store.getState()
    const nodes = getNodes()
    const nodesWithSameType = nodes.filter(node => node.data.type === type)
    const {
      defaultValue,
    } = nodesMetaDataMap![type]
    const { newNode } = generateNewNode({
      type: getNodeCustomTypeByNodeDataType(type),
      data: {
        ...(defaultValue as any),
        title: nodesWithSameType.length > 0 ? `${defaultValue.title} ${nodesWithSameType.length + 1}` : defaultValue.title,
        ...toolDefaultValue,
        _isCandidate: true,
      },
      position: {
        x: 0,
        y: 0,
      },
    })
    workflowStore.setState({
      candidateNode: newNode,
    })
  }, [store, workflowStore, nodesMetaDataMap])

  const renderTriggerElement = useCallback((open: boolean) => {
    return (
      <TipPopup
        title={t('workflow.common.addBlock')}
      >
        <div className={cn(
          'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary',
          `${nodesReadOnly && 'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled'}`,
          open && 'bg-state-accent-active text-text-accent',
        )}>
          <RiAddCircleFill className='h-4 w-4' />
        </div>
      </TipPopup>
    )
  }, [nodesReadOnly, t])

  return (
    <BlockSelector
      open={open}
      onOpenChange={handleOpenChange}
      disabled={nodesReadOnly}
      onSelect={handleSelect}
      placement='right-start'
      offset={offset ?? {
        mainAxis: 4,
        crossAxis: -8,
      }}
      trigger={renderTrigger || renderTriggerElement}
      popupClassName='!min-w-[256px]'
      availableBlocksTypes={availableNextBlocks}
    />
  )
}

export default memo(AddBlock)
