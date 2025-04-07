import {
  memo,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import Badge from '@/app/components/base/badge'
import type { Node } from '@/app/components/workflow/types'

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

  const VariableIcon = useMemo(() => {
    if (isEnv) {
      return (
        <Env className='h-3.5 w-3.5 shrink-0 text-util-colors-violet-violet-600' />
      )
    }

    if (isChatVar) {
      return (
        <BubbleX className='h-3.5 w-3.5 shrink-0 text-util-colors-teal-teal-700' />
      )
    }

    return (
      <Variable02
        className={cn(
          'h-3.5 w-3.5 shrink-0 text-text-accent',
          isException && 'text-text-warning',
        )}
      />
    )
  }, [isEnv, isChatVar, isException])

  const VariableName = useMemo(() => {
    return (
      <div
        className={cn(
          'system-xs-medium ml-0.5 shrink truncate text-text-accent',
          isEnv && 'text-gray-900',
          isException && 'text-text-warning',
          isChatVar && 'text-util-colors-teal-teal-700',
        )}
        title={varName}
      >
        {varName}
      </div>
    )
  }, [isEnv, isChatVar, varName, isException])
  return (
    <div className={cn(
      'relative flex items-center gap-1 self-stretch rounded-md bg-workflow-block-parma-bg p-[3px] pl-[5px]',
      showBorder && '!bg-black/[0.02]',
      className,
    )}>
      <div className='flex w-0 grow items-center'>
        {
          node && (
            <>
              <div className='shrink-0 p-[1px]'>
                <VarBlockIcon
                  className='!text-gray-900'
                  type={node.data.type}
                />
              </div>
              <div
                className='mx-0.5 shrink-[1000] truncate text-xs font-medium text-gray-700'
                title={node?.data.title}
              >
                {node?.data.title}
              </div>
              <Line3 className='mr-0.5 shrink-0'></Line3>
            </>
          )
        }
        {VariableIcon}
        {VariableName}
      </div>
      {writeMode && <Badge className='shrink-0' text={t(`${i18nPrefix}.operations.${writeMode}`)} />}
    </div>
  )
}

export default memo(NodeVariableItem)
