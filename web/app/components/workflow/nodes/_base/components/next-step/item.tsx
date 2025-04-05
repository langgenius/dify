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
      className='group relative flex h-9 cursor-pointer items-center rounded-lg border-[0.5px] border-divider-regular bg-background-default px-2 text-xs text-text-secondary shadow-xs last-of-type:mb-0 hover:bg-background-default-hover'
    >
      <BlockIcon
        type={data.type}
        toolIcon={toolIcon}
        className='mr-1.5 shrink-0'
      />
      <div
        className='system-xs-medium grow truncate text-text-secondary'
        title={data.title}
      >
        {data.title}
      </div>
      {
        !nodesReadOnly && (
          <>
            <Button
              className='mr-1 hidden shrink-0 group-hover:flex'
              size='small'
              onClick={() => handleNodeSelect(nodeId)}
            >
              {t('workflow.common.jumpToNode')}
            </Button>
            <div
              className={cn(
                'hidden shrink-0 items-center group-hover:flex',
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
