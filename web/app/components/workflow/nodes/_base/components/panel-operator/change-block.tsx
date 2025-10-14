import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { intersection } from 'lodash-es'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useAvailableBlocks,
  useIsChatMode,
  useNodesInteractions,
} from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import type {
  Node,
  OnSelectBlock,
} from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'

type ChangeBlockProps = {
  nodeId: string
  nodeData: Node['data']
  sourceHandle: string
}
const ChangeBlock = ({
  nodeId,
  nodeData,
  sourceHandle,
}: ChangeBlockProps) => {
  const { t } = useTranslation()
  const { handleNodeChange } = useNodesInteractions()
  const {
    availablePrevBlocks,
    availableNextBlocks,
  } = useAvailableBlocks(nodeData.type, nodeData.isInIteration || nodeData.isInLoop)
  const isChatMode = useIsChatMode()
  const flowType = useHooksStore(s => s.configsMap?.flowType)
  const showStartTab = flowType !== FlowType.ragPipeline && !isChatMode

  const availableNodes = useMemo(() => {
    if (availablePrevBlocks.length && availableNextBlocks.length)
      return intersection(availablePrevBlocks, availableNextBlocks)
    else if (availablePrevBlocks.length)
      return availablePrevBlocks
    else
      return availableNextBlocks
  }, [availablePrevBlocks, availableNextBlocks])

  const handleSelect = useCallback<OnSelectBlock>((type, pluginDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, pluginDefaultValue)
  }, [handleNodeChange, nodeId, sourceHandle])

  const renderTrigger = useCallback(() => {
    return (
      <div className='flex h-8 w-[232px] cursor-pointer items-center rounded-lg px-3 text-sm text-text-secondary hover:bg-state-base-hover'>
        {t('workflow.panel.changeBlock')}
      </div>
    )
  }, [t])

  return (
    <BlockSelector
      placement='bottom-end'
      offset={{
        mainAxis: -36,
        crossAxis: 4,
      }}
      onSelect={handleSelect}
      trigger={renderTrigger}
      popupClassName='min-w-[240px]'
      availableBlocksTypes={availableNodes}
      showStartTab={showStartTab}
    />
  )
}

export default memo(ChangeBlock)
