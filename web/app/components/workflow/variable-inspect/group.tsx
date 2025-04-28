import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  // RiErrorWarningFill,
  // RiLoader2Line,
} from '@remixicon/react'
import { useStore } from '../store'
// import { BlockEnum } from '../types'
// import Button from '@/app/components/base/button'
// import ActionButton from '@/app/components/base/action-button'
// import Tooltip from '@/app/components/base/tooltip'
// import BlockIcon from '@/app/components/workflow/block-icon'
import {
  // BubbleX,
  Env,
} from '@/app/components/base/icons/src/vender/line/others'
// import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
// import useCurrentVars from '../hooks/use-inspect-vars-crud'
import type { currentVarType } from './panel'
import cn from '@/utils/classnames'

type Props = {
  isEnv?: boolean
  isChatVar?: boolean
  isSystem?: boolean
  currentVar?: currentVarType
  handleSelect: (state: any) => void
}

const Group = ({
  isEnv,
  isChatVar,
  isSystem,
  currentVar,
  handleSelect,
}: Props) => {
  const { t } = useTranslation()

  const environmentVariables = useStore(s => s.environmentVariables)
  // const {
  //   conversationVars,
  //   systemVars,
  //   nodesWithInspectVars,
  // } = useCurrentVars()

  const [isCollapsed, setIsCollapsed] = useState(false)

  const handleSelectVar = (varItem: any, type?: string) => {
    if (type === 'env') {
      handleSelect({
        nodeId: 'env',
        nodeTitle: 'env',
        nodeType: 'env',
        var: {
          ...varItem,
          type: 'env',
          ...(varItem.value_type === 'secret' ? { value: '******************' } : {}),
        },
      })
      return
    }
    if (type === 'chat') {
      handleSelect({
        nodeId: 'conversation',
        nodeTitle: 'conversation',
        nodeType: 'conversation',
        var: {
          ...varItem,
          type: 'conversation',
        },
      })
      return
    }
    if (type === 'system') {
      handleSelect({
        nodeId: 'sys',
        nodeTitle: 'sys',
        nodeType: 'sys',
        var: varItem,
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
          {environmentVariables.length > 0 && environmentVariables.map(env => (
            <div
              key={env.id}
              className={cn(
                'relative flex cursor-pointer items-center gap-1 rounded-md px-3 py-1 hover:bg-state-base-hover',
                env.id === currentVar?.var.id && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
              )}
              onClick={() => handleSelectVar(env, 'env')}
            >
              <Env className='h-4 w-4 shrink-0 text-util-colors-violet-violet-600' />
              <div className='system-sm-medium grow truncate text-text-secondary'>{env.name}</div>
              <div className='system-xs-regular shrink-0 text-text-tertiary'>{env.value_type}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default Group
