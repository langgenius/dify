import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { VarType } from '@/app/components/workflow/types'
import cn from '@/utils/classnames'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  valueSelector?: ValueSelector
  varType?: VarType
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  onSelect: (valueSelector: ValueSelector, varItem: Var) => void
  disabled?: boolean
}

const ConditionVarSelector = ({
  open,
  onOpenChange,
  valueSelector,
  varType,
  availableVars,
  availableNodes,
  onSelect,
  disabled,
}: Props) => {
  const { t } = useTranslation()

  const handleTriggerClick = useCallback(() => {
    if (disabled)
      return
    onOpenChange(!open)
  }, [disabled, onOpenChange, open])

  const handleSelect = useCallback((selector: ValueSelector, varItem: Var) => {
    if (disabled)
      return
    onSelect(selector, varItem)
    onOpenChange(false)
  }, [disabled, onOpenChange, onSelect])

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={(state) => {
        if (!disabled)
          onOpenChange(state)
      }}
      placement='bottom-start'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTriggerClick}>
        <div className={cn('cursor-pointer', disabled && '!cursor-not-allowed opacity-60')}>
          {valueSelector && valueSelector.length > 0 ? (
            <VariableTag
              valueSelector={valueSelector}
              varType={varType ?? VarType.string}
              isShort
              availableNodes={availableNodes}
            />
          ) : (
            <div className='inline-flex h-6 items-center rounded-md border border-dashed border-divider-subtle px-2 text-xs text-text-tertiary'>
              {t('workflow.nodes.agent.toolCondition.selectVariable')}
            </div>
          )}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[1000]'>
        <div className='w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <VarReferenceVars
            vars={availableVars}
            isSupportFileVar
            onChange={handleSelect}
          />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(ConditionVarSelector)
