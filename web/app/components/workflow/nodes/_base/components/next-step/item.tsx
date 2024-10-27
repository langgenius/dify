import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { intersection } from 'lodash-es'
import type {
  CommonNodeType,
  OnSelectBlock,
} from '@/app/components/workflow/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useAvailableBlocks,
  useNodesInteractions,
  useNodesReadOnly,
  useToolIcon,
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
  const { nodesReadOnly } = useNodesReadOnly()
  const toolIcon = useToolIcon(data)
  const {
    availablePrevBlocks,
    availableNextBlocks,
  } = useAvailableBlocks(data.type, data.isInIteration)

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, toolDefaultValue)
  }, [nodeId, sourceHandle, handleNodeChange])
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <Button
        size='small'
        className={`
          hidden group-hover:flex
          ${open && '!bg-gray-100 !flex'}
        `}
      >
        {t('workflow.panel.change')}
      </Button>
    )
  }, [t])

  return (
    <div
      className='relative group flex items-center mb-3 last-of-type:mb-0 px-2 h-9 rounded-lg border-[0.5px] border-divider-regular bg-background-default hover:bg-background-default-hover shadow-xs text-xs text-text-secondary cursor-pointer'
    >
      {
        branchName && (
          <div
            className='absolute left-1 right-1 -top-[7.5px] flex items-center h-3 text-[10px] text-gray-500 font-semibold'
            title={branchName.toLocaleUpperCase()}
          >
            <div className='inline-block px-0.5 rounded-[5px] bg-white truncate'>{branchName.toLocaleUpperCase()}</div>
          </div>
        )
      }
      <BlockIcon
        type={data.type}
        toolIcon={toolIcon}
        className='shrink-0 mr-1.5'
      />
      <div className='grow system-xs-medium text-text-secondary'>{data.title}</div>
      {
        !nodesReadOnly && (
          <BlockSelector
            onSelect={handleSelect}
            placement='top-end'
            offset={{
              mainAxis: 6,
              crossAxis: 8,
            }}
            trigger={renderTrigger}
            popupClassName='!w-[328px]'
            availableBlocksTypes={intersection(availablePrevBlocks, availableNextBlocks).filter(item => item !== data.type)}
          />
        )
      }
    </div>
  )
}

export default memo(Item)
