import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { union } from 'lodash-es'
import type {
  CommonNodeType,
  OnSelectBlock,
} from '@/app/components/workflow/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useNodesExtraData,
  useNodesInteractions,
} from '@/app/components/workflow/hooks'
import Button from '@/app/components/base/button'

type ItemProps = {
  nodeId: string
  sourceHandle: string
  branchName?: string
  data: CommonNodeType
}
const Item = ({
  nodeId,
  sourceHandle,
  branchName,
  data,
}: ItemProps) => {
  const { t } = useTranslation()
  const { handleNodeChange } = useNodesInteractions()
  const nodesExtraData = useNodesExtraData()
  const availablePrevNodes = nodesExtraData[data.type].availablePrevNodes
  const availableNextNodes = nodesExtraData[data.type].availableNextNodes
  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, toolDefaultValue)
  }, [nodeId, sourceHandle, handleNodeChange])
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <Button
        className={`
          hidden group-hover:flex px-2 py-0 h-6 bg-white text-xs text-gray-700 font-medium rounded-md 
          ${open && '!bg-gray-100 !flex'}
        `}
      >
        {t('workflow.panel.change')}
      </Button>
    )
  }, [t])

  return (
    <div
      className='relative group flex items-center mb-3 last-of-type:mb-0 px-2 h-9 rounded-lg border-[0.5px] border-gray-200 bg-white hover:bg-gray-50 shadow-xs text-xs text-gray-700 cursor-pointer'
    >
      {
        branchName && (
          <div
            className='absolute left-1 right-1 -top-[7.5px] flex items-center px-0.5 h-3 bg-white text-[10px] text-gray-500 font-semibold rounded-[5px] truncate'
            title={branchName.toLocaleUpperCase()}
          >
            {branchName.toLocaleUpperCase()}
          </div>
        )
      }
      <BlockIcon
        type={data.type}
        toolProviderId={data.provider_id}
        className='shrink-0 mr-1.5'
      />
      <div className='grow'>{data.title}</div>
      <BlockSelector
        onSelect={handleSelect}
        placement='top-end'
        offset={{
          mainAxis: 6,
          crossAxis: 8,
        }}
        trigger={renderTrigger}
        popupClassName='!w-[328px]'
        availableBlocksTypes={union(availablePrevNodes, availableNextNodes)}
      />
    </div>
  )
}

export default memo(Item)
