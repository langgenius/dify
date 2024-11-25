import { useMemo } from 'react'
import { useNodes } from 'reactflow'
import { capitalize } from 'lodash-es'
import { useTranslation } from 'react-i18next'
import { RiErrorWarningFill } from '@remixicon/react'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import type {
  CommonNodeType,
  Node,
  ValueSelector,
  VarType,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import { getNodeInfoById, isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type VariableTagProps = {
  valueSelector: ValueSelector
  varType: VarType
  isShort?: boolean
  availableNodes?: Node[]
}
const VariableTag = ({
  valueSelector,
  varType,
  isShort,
  availableNodes,
}: VariableTagProps) => {
  const nodes = useNodes<CommonNodeType>()
  const node = useMemo(() => {
    if (isSystemVar(valueSelector)) {
      const startNode = availableNodes?.find(n => n.data.type === BlockEnum.Start)
      if (startNode)
        return startNode
    }
    return getNodeInfoById(availableNodes || nodes, valueSelector[0])
  }, [nodes, valueSelector, availableNodes])

  const isEnv = isENV(valueSelector)
  const isChatVar = isConversationVar(valueSelector)
  const isValid = Boolean(node) || isEnv || isChatVar

  const variableName = isSystemVar(valueSelector) ? valueSelector.slice(0).join('.') : valueSelector.slice(1).join('.')

  const { t } = useTranslation()
  return (
    <Tooltip popupContent={!isValid && t('workflow.errorMsg.invalidVariable')}>
      <div className={cn('inline-flex items-center px-1.5 max-w-full h-6 text-xs rounded-md border-[0.5px] border-[rgba(16, 2440,0.08)] bg-white shadow-xs',
        !isValid && 'border-red-400 !bg-[#FEF3F2]',
      )}>
        {(!isEnv && !isChatVar && <>
          {node && (
            <>
              <VarBlockIcon
                type={BlockEnum.Start}
              />
              <div
                className='max-w-[60px] truncate text-text-secondary font-medium'
                title={node?.data.title}
              >
                {node?.data.title}
              </div>
            </>
          )}
          <Line3 className='shrink-0 mx-0.5' />
          <Variable02 className='shrink-0 mr-0.5 w-3.5 h-3.5 text-text-accent' />
        </>)}
        {isEnv && <Env className='shrink-0 mr-0.5 w-3.5 h-3.5 text-util-colors-violet-violet-600' />}
        {isChatVar && <BubbleX className='w-3.5 h-3.5 text-util-colors-teal-teal-700' />}
        <div
          className={cn('truncate text-text-accent font-medium', (isEnv || isChatVar) && 'text-text-secondary')}
          title={variableName}
        >
          {variableName}
        </div>
        {
          !isShort && varType && (
            <div className='shrink-0 ml-0.5 text-text-tertiary'>{capitalize(varType)}</div>
          )
        }
        {!isValid && <RiErrorWarningFill className='ml-0.5 w-3 h-3 text-[#D92D20]' />}
      </div>
    </Tooltip>
  )
}

export default VariableTag
