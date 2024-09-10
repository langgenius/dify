import {
  memo,
  useCallback,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import Operator from './operator'
import type {
  CommonNodeType,
} from '@/app/components/workflow/types'
import BlockIcon from '@/app/components/workflow/block-icon'
import {
  useNodesInteractions,
  useNodesReadOnly,
  useToolIcon,
} from '@/app/components/workflow/hooks'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'

type ItemProps = {
  nodeId: string
  sourceHandle: string
  data: CommonNodeType
}
const Item = ({
  nodeId,
  sourceHandle,
  data,
}: ItemProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { nodesReadOnly } = useNodesReadOnly()
  const { handleNodeSelect } = useNodesInteractions()
  const toolIcon = useToolIcon(data)

  const handleOpenChange = useCallback((v: boolean) => {
    setOpen(v)
  }, [])

  return (
    <div
      className='relative group flex items-center last-of-type:mb-0 px-2 h-9 rounded-lg border-[0.5px] border-divider-regular bg-background-default hover:bg-background-default-hover shadow-xs text-xs text-text-secondary cursor-pointer'
    >
      <BlockIcon
        type={data.type}
        toolIcon={toolIcon}
        className='shrink-0 mr-1.5'
      />
      <div
        className='grow system-xs-medium text-text-secondary truncate'
        title={data.title}
      >
        {data.title}
      </div>
      {
        !nodesReadOnly && (
          <>
            <Button
              className='hidden group-hover:flex shrink-0 mr-1'
              size='small'
              onClick={() => handleNodeSelect(nodeId)}
            >
              {t('workflow.common.jumpToNode')}
            </Button>
            <div
              className={cn(
                'hidden shrink-0 group-hover:flex items-center',
                open && 'flex',
              )}
            >
              <Operator
                data={data}
                nodeId={nodeId}
                sourceHandle={sourceHandle}
                open={open}
                onOpenChange={handleOpenChange}
              />
            </div>
          </>
        )
      }
    </div>
  )
}

export default memo(Item)
