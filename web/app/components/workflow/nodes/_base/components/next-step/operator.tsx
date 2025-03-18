import {
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiMoreFill } from '@remixicon/react'
import { intersection } from 'lodash-es'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import BlockSelector from '@/app/components/workflow/block-selector'
import {
  useAvailableBlocks,
  useNodesInteractions,
} from '@/app/components/workflow/hooks'
import type {
  CommonNodeType,
  OnSelectBlock,
} from '@/app/components/workflow/types'

type ChangeItemProps = {
  data: CommonNodeType
  nodeId: string
  sourceHandle: string
}
const ChangeItem = ({
  data,
  nodeId,
  sourceHandle,
}: ChangeItemProps) => {
  const { t } = useTranslation()

  const { handleNodeChange } = useNodesInteractions()
  const {
    availablePrevBlocks,
    availableNextBlocks,
  } = useAvailableBlocks(data.type, data.isInIteration, data.isInLoop)

  const handleSelect = useCallback<OnSelectBlock>((type, toolDefaultValue) => {
    handleNodeChange(nodeId, type, sourceHandle, toolDefaultValue)
  }, [nodeId, sourceHandle, handleNodeChange])

  const renderTrigger = useCallback(() => {
    return (
      <div className='flex items-center px-2 h-8 rounded-lg cursor-pointer hover:bg-state-base-hover'>
        {t('workflow.panel.change')}
      </div>
    )
  }, [t])

  return (
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

type OperatorProps = {
  open: boolean
  onOpenChange: (v: boolean) => void
  data: CommonNodeType
  nodeId: string
  sourceHandle: string
}
const Operator = ({
  open,
  onOpenChange,
  data,
  nodeId,
  sourceHandle,
}: OperatorProps) => {
  const { t } = useTranslation()
  const {
    handleNodeDelete,
    handleNodeDisconnect,
  } = useNodesInteractions()

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{ mainAxis: 4, crossAxis: -4 }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <PortalToFollowElemTrigger onClick={() => onOpenChange(!open)}>
        <Button className='p-0 w-6 h-6'>
          <RiMoreFill className='w-4 h-4' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='min-w-[120px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg system-md-regular text-text-secondary'>
          <div className='p-1'>
            <ChangeItem
              data={data}
              nodeId={nodeId}
              sourceHandle={sourceHandle}
            />
            <div
              className='flex items-center px-2 h-8 rounded-lg cursor-pointer hover:bg-state-base-hover'
              onClick={() => handleNodeDisconnect(nodeId)}
            >
              {t('workflow.common.disconnect')}
            </div>
          </div>
          <div className='p-1'>
            <div
              className='flex items-center px-2 h-8 rounded-lg cursor-pointer hover:bg-state-base-hover'
              onClick={() => handleNodeDelete(nodeId)}
            >
              {t('common.operation.delete')}
            </div>
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Operator
