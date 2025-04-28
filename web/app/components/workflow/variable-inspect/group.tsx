import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  // RiErrorWarningFill,
  // RiLoader2Line,
} from '@remixicon/react'
// import { BlockEnum } from '../types'
// import Button from '@/app/components/base/button'
// import ActionButton from '@/app/components/base/action-button'
// import Tooltip from '@/app/components/base/tooltip'
// import BlockIcon from '@/app/components/workflow/block-icon'
import {
  BubbleX,
  Env,
} from '@/app/components/base/icons/src/vender/line/others'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import type { currentVarType } from './panel'
import { VarInInspectType } from '@/types/workflow'
import type { VarInInspect } from '@/types/workflow'
import cn from '@/utils/classnames'

type Props = {
  currentVar?: currentVarType
  varType: VarInInspectType
  varList: VarInInspect[]
  handleSelect: (state: any) => void
}

const Group = ({
  currentVar,
  varType,
  varList,
  handleSelect,
}: Props) => {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)

  const isEnv = varType === VarInInspectType.environment
  const isChatVar = varType === VarInInspectType.conversation
  const isSystem = varType === VarInInspectType.system

  const handleSelectVar = (varItem: any, type?: string) => {
    if (type === VarInInspectType.environment) {
      handleSelect({
        nodeId: 'env',
        nodeTitle: 'env',
        nodeType: VarInInspectType.environment,
        var: {
          ...varItem,
          type: VarInInspectType.environment,
          ...(varItem.value_type === 'secret' ? { value: '******************' } : {}),
        },
      })
      return
    }
    if (type === VarInInspectType.conversation) {
      handleSelect({
        nodeId: 'conversation',
        nodeTitle: 'conversation',
        nodeType: VarInInspectType.conversation,
        var: {
          ...varItem,
          type: VarInInspectType.conversation,
        },
      })
      return
    }
    if (type === VarInInspectType.system) {
      handleSelect({
        nodeId: 'sys',
        nodeTitle: 'sys',
        nodeType: VarInInspectType.system,
        var: {
          ...varItem,
          type: VarInInspectType.system,
        },
      })
      return
    }
    handleSelect({
      nodeId: varItem.nodeId,
      nodeTitle: varItem.nodeTitle,
      nodeType: varItem.nodeType,
      var: varItem.var,
    })
  }

  return (
    <div className='p-0.5'>
      {/* node item */}
      <div className='flex h-6 items-center gap-0.5'>
        <RiArrowRightSLine className={cn('h-3 w-3 text-text-tertiary', !isCollapsed && 'rotate-90')} />
        <div className='flex grow cursor-pointer items-center gap-1' onClick={() => setIsCollapsed(!isCollapsed)}>
          <div className='system-xs-medium-uppercase truncate text-text-tertiary'>
            {isEnv && t('workflow.debug.variableInspect.envNode')}
            {isChatVar && t('workflow.debug.variableInspect.chatNode')}
            {isSystem && t('workflow.debug.variableInspect.systemNode')}
          </div>
        </div>
      </div>
      {/* var item list */}
      {!isCollapsed && (
        <div className='px-0.5'>
          {varList.length > 0 && varList.map(varItem => (
            <div
              key={varItem.id}
              className={cn(
                'relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover',
                varItem.id === currentVar?.var.id && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
              )}
              onClick={() => handleSelectVar(varItem, varType)}
            >
              {isEnv && <Env className='h-4 w-4 shrink-0 text-util-colors-violet-violet-600' />}
              {isChatVar && <BubbleX className='h-4 w-4 shrink-0 text-util-colors-teal-teal-700' />}
              {isSystem && <Variable02 className='h-4 w-4 shrink-0 text-text-accent' />}
              <div className='system-sm-medium grow truncate text-text-secondary'>{varItem.name}</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>{varItem.value_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Group
