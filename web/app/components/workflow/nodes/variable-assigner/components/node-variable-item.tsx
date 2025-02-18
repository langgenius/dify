import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import Badge from '@/app/components/base/badge'
import type { Node } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'

type NodeVariableItemProps = {
  isEnv: boolean
  isChatVar: boolean
  node: Node
  varName: string
  writeMode?: string
  showBorder?: boolean
  className?: string
  isException?: boolean
}

const i18nPrefix = 'workflow.nodes.assigner'

const NodeVariableItem = ({
  isEnv,
  isChatVar,
  node,
  varName,
  writeMode,
  showBorder,
  className,
  isException,
}: NodeVariableItemProps) => {
  const { t } = useTranslation()
  return (
    <div className={cn(
      'bg-workflow-block-parma-bg relative flex items-center gap-1 self-stretch rounded-md p-[3px] pl-[5px]',
      showBorder && '!bg-black/[0.02]',
      className,
    )}>
      {!isEnv && !isChatVar && (
        <div className='flex items-center'>
          <div className='p-[1px]'>
            <VarBlockIcon
              className='!text-gray-900'
              type={node?.data.type || BlockEnum.Start}
            />
          </div>
          <div className='mx-0.5 max-w-[85px] truncate text-xs font-medium text-gray-700' title={node?.data.title}>{node?.data.title}</div>
          <Line3 className='mr-0.5'></Line3>
        </div>
      )}
      <div className='text-primary-600 flex w-full items-center'>
        {!isEnv && !isChatVar && <Variable02 className={cn('text-primary-500 h-3.5 w-3.5 shrink-0', isException && 'text-text-warning')} />}
        {isEnv && <Env className='text-util-colors-violet-violet-600 h-3.5 w-3.5 shrink-0' />}
        {!isChatVar && <div className={cn('system-xs-medium ml-0.5 max-w-[75px] overflow-hidden truncate text-ellipsis', isEnv && 'text-gray-900', isException && 'text-text-warning')} title={varName}>{varName}</div>}
        {isChatVar
          && <div className='flex w-full items-center gap-1'>
            <div className='flex h-[18px] min-w-[18px] flex-1 items-center gap-0.5'>
              <BubbleX className='text-util-colors-teal-teal-700 h-3.5 w-3.5' />
              <div className={cn('system-xs-medium text-util-colors-teal-teal-700 ml-0.5 max-w-[75px] overflow-hidden truncate text-ellipsis')}>{varName}</div>
            </div>
            {writeMode && <Badge className='shrink-0' text={t(`${i18nPrefix}.operations.${writeMode}`)} />}
          </div>
        }
      </div>
    </div>
  )
}

export default memo(NodeVariableItem)
