import type { RefObject } from 'react'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'

type AddVariablePopupProps = {
  availableVars: NodeOutPutVar[]
  keyboardTarget: HTMLElement | RefObject<HTMLElement | null> | null
  onSelect: (value: ValueSelector, item: Var) => void
}
const AddVariablePopup = ({ availableVars, keyboardTarget, onSelect }: AddVariablePopupProps) => {
  const { t } = useTranslation(['workflowLogic'])

  return (
    <div className="w-60 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg">
      <div className="flex h-8.5 items-center border-b-[0.5px] border-b-divider-regular px-4 text-[13px] font-semibold text-text-secondary">
        {t(($) => $['nodes.variableAssigner.setAssignVariable'], { ns: 'workflowLogic' })}
      </div>
      <div className="p-1">
        <VarReferenceVars
          hideSearch
          keyboardTarget={keyboardTarget}
          vars={availableVars}
          onChange={onSelect}
          isSupportFileVar
        />
      </div>
    </div>
  )
}

export default memo(AddVariablePopup)
