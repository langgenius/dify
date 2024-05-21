import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import type {
  NodeOutPutVar,
  ValueSelector,
} from '@/app/components/workflow/types'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type { VariableAssignerNodeType } from '@/app/components/workflow/nodes/variable-assigner/types'

export type AddVariablePopupProps = {
  variableAssignerNodeId: string
  variableAssignerNodeData: VariableAssignerNodeType
  availableVars: NodeOutPutVar[]
  onSelect?: () => void
}
export const AddVariablePopup = ({
  variableAssignerNodeId,
  variableAssignerNodeData,
  availableVars,
  onSelect,
}: AddVariablePopupProps) => {
  const { t } = useTranslation()
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const handleSelectVariable = useCallback((v: ValueSelector) => {
    handleNodeDataUpdate({
      id: variableAssignerNodeId,
      data: {
        variables: [...variableAssignerNodeData.variables, v],
        _showAddVariablePopup: false,
      },
    })

    if (onSelect)
      onSelect()
  }, [
    variableAssignerNodeData.variables,
    handleNodeDataUpdate,
    variableAssignerNodeId,
    onSelect,
  ])

  return (
    <div className='w-[240px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg'>
      <div className='flex items-center px-4 h-[34px] text-[13px] font-semibold text-gray-700 border-b-[0.5px] border-b-gray-200'>
        {t('workflow.nodes.variableAssigner.setAssignVariable')}
      </div>
      <div className='p-1'>
        <VarReferenceVars
          hideSearch
          vars={availableVars}
          onChange={handleSelectVariable}
        />
      </div>
    </div>
  )
}

export default memo(AddVariablePopup)
