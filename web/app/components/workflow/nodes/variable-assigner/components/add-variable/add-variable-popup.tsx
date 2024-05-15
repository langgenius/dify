import {
  memo,
  useCallback,
} from 'react'
import type { AddVariableProps } from './index'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type { ValueSelector } from '@/app/components/workflow/types'

export const AddVariablePopup = ({
  nodeId,
  data,
  onSelect,
}: AddVariableProps & { onSelect?: () => void }) => {
  const { handleNodeDataUpdate } = useNodeDataUpdate()
  const { availableVars } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })
  const handleSelectVariable = useCallback((v: ValueSelector) => {
    handleNodeDataUpdate({
      id: nodeId,
      data: {
        variables: [...data.variables, v],
        _showVariablePicker: false,
      },
    })

    if (onSelect)
      onSelect()
  }, [data.variables, handleNodeDataUpdate, nodeId, onSelect])

  return (
    <div className='w-[240px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg'>
      <div className='flex items-center px-4 h-[34px] text-[13px] font-semibold text-gray-700 border-b-[0.5px] border-b-gray-200'>
        Set assign variable
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
