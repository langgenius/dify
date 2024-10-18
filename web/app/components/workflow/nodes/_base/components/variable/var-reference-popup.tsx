'use client'
import type { FC } from 'react'
import React from 'react'
import VarReferenceVars from './var-reference-vars'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'

type Props = {
  vars: NodeOutPutVar[]
  onChange: (value: ValueSelector, varDetail: Var) => void
  itemWidth?: number
}
const VarReferencePopup: FC<Props> = ({
  vars,
  onChange,
  itemWidth,
}) => {
  // max-h-[300px] overflow-y-auto todo: use portal to handle long list
  return (
    <div className='p-1 bg-white rounded-lg border border-gray-200 shadow-lg space-y-1' style={{
      width: itemWidth || 228,
    }}>
      <VarReferenceVars
        searchBoxClassName='mt-1'
        vars={vars}
        onChange={onChange}
        itemWidth={itemWidth}
        isSupportFileVar
      />
    </div >
  )
}
export default React.memo(VarReferencePopup)
