import type {
  Node,
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import VariableTag from '@/app/components/workflow/nodes/_base/components/variable-tag'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import { VarType } from '@/app/components/workflow/types'
import { cn } from '@/utils/classnames'

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
  const { t } = useTranslation('workflow')

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
      placement="bottom-start"
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
    >
      <PortalToFollowElemTrigger onClick={handleTriggerClick}>
        <div className={cn('cursor-pointer', disabled && '!cursor-not-allowed opacity-60')}>
          {valueSelector && valueSelector.length > 0
            ? (
                <VariableTag
                  valueSelector={valueSelector}
                  varType={varType ?? VarType.string}
                  isShort
                  availableNodes={availableNodes}
                />
              )
            : (
                <div className="system-xs-regular text-text-tertiary">{t('nodes.agent.toolCondition.selectVariable', { ns: 'workflow' })}</div>
              )}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[1000]">
        <div className="w-[296px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg">
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
