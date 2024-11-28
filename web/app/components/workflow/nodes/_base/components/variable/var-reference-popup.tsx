'use client'
import type { FC } from 'react'
import React from 'react'
import VarReferenceVars from './var-reference-vars'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import ListEmpty from '@/app/components/base/list-empty'

type Props = {
  vars: NodeOutPutVar[]
  popupFor?: 'assigned' | 'toAssigned'
  onChange: (value: ValueSelector, varDetail: Var) => void
  itemWidth?: number
  isSupportFileVar?: boolean
}
const VarReferencePopup: FC<Props> = ({
  vars,
  popupFor,
  onChange,
  itemWidth,
  isSupportFileVar = true,
}) => {
  // max-h-[300px] overflow-y-auto todo: use portal to handle long list
  return (
    <div className='p-1 bg-white rounded-lg border border-gray-200 shadow-lg space-y-1' style={{
      width: itemWidth || 228,
    }}>
      {(!vars || vars.length === 0)
        ? (popupFor === 'toAssigned'
          ? (
            <ListEmpty
              title='No available variables'
              description={<div className='text-text-tertiary system-xs-regular'>There are no variables available for assignment with the selected operation.</div>}
            />
          )
          : (
            <ListEmpty
              title='No available assigned variables'
              description={<div className='text-text-tertiary system-xs-regular'>Assigned variables must be writable variables, such as <span className='text-text-accent-secondary'>conversation variables</span>.</div>}
            />
          ))
        : <VarReferenceVars
          searchBoxClassName='mt-1'
          vars={vars}
          onChange={onChange}
          itemWidth={itemWidth}
          isSupportFileVar={isSupportFileVar}
        />
      }
    </div >
  )
}
export default React.memo(VarReferencePopup)
