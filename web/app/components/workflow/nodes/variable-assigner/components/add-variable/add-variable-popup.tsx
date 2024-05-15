import { memo } from 'react'
import VarReferenceVars from '@/app/components/workflow/nodes/_base/components/variable/var-reference-vars'
import useAvailableVarList from '@/app/components/workflow/nodes/_base/hooks/use-available-var-list'

type AddVariablePopupProps = {
  nodeId: string
}

export const AddVariablePopup = ({
  nodeId,
}: AddVariablePopupProps) => {
  const { availableVars } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  })

  return (
    <div className='w-[240px] bg-white border-[0.5px] border-gray-200 rounded-lg shadow-lg'>
      <div className='flex items-center px-4 h-[34px] text-[13px] font-semibold text-gray-700 border-b-[0.5px] border-b-gray-200'>
        Set assign variable
      </div>
      <div className='p-1'>
        <VarReferenceVars
          hideSearch
          vars={availableVars}
          onChange={() => {}}
        />
      </div>
    </div>
  )
}

export default memo(AddVariablePopup)
