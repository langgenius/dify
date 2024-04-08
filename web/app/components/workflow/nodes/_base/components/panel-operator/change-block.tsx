import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import { intersection } from 'lodash-es'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useNodesExtraData,
  useNodesInteractions,
} from '@/app/components/workflow/hooks'
import type {
  BlockEnum,
  OnSelectBlock,
} from '@/app/components/workflow/types'

type ChangeBlockProps = {
  nodeId: string
  nodeType: BlockEnum
  sourceHandle: string
}
const ChangeBlock = ({
  nodeId,
  nodeType,
  sourceHandle,
}: ChangeBlockProps) => {
  const { t } = useTranslation()
  const { handleNodeChange } = useNodesInteractions()
  const nodesExtraData = useNodesExtraData()
  const availablePrevNodes = nodesExtraData[nodeType].availablePrevNodes
  const availableNextNodes = nodesExtraData[nodeType].availableNextNodes

  const availableNodes = useMemo(() => {
    if (availableNextNodes.length && availableNextNodes.length)
      return intersection(availablePrevNodes, availableNextNodes)
    else if (availablePrevNodes.length)
      return availablePrevNodes
    else
      return availableNextNodes
  }, [availablePrevNodes, availableNextNodes])

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, toolDefaultValue)
  }, [handleNodeChange, nodeId, sourceHandle])

  const renderTrigger = useCallback(() => {
    return (
      <div className='flex items-center px-3 w-[232px] h-8 text-sm text-gray-700 rounded-lg cursor-pointer hover:bg-gray-50'>
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
    />
  )
}

export default memo(ChangeBlock)
