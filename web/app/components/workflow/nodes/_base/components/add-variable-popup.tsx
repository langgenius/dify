import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import type {
  NodeOutPutVar,
  ValueSelector,
  Var,
} from '@/app/components/workflow/types'

export type AddVariablePopupProps = {
  availableVars: NodeOutPutVar[]
  onSelect: (value: ValueSelector, item: Var) => void
}
export const AddVariablePopup = ({
  availableVars,
  onSelect,
}: AddVariablePopupProps) => {
  const { t } = useTranslation()

  return (
    <div className='w-[240px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg'>
      <div className='flex h-[34px] items-center border-b-[0.5px] border-b-divider-regular px-4 text-[13px] font-semibold text-text-secondary'>
        {t('workflow.nodes.variableAssigner.setAssignVariable')}
      </div>
      <div className='p-1'>
        <VarReferenceVars
          hideSearch
          vars={availableVars}
          onChange={onSelect}
          isSupportFileVar
        />
      </div>
    </div>
  )
}

export default memo(AddVariablePopup)
