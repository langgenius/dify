'use client'
import type { FC } from 'react'
import React from 'react'
import mockStructData from '@/app/components/workflow/nodes/llm/mock-struct-data'
import VarFullPathPanel from '../var-full-path-panel'
import PickerPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/picker'
import ShowPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'
import { Type } from '../../../../llm/types'

const Test: FC = () => {
  return (
    <div className='mb-2 space-y-2'>
      <VarFullPathPanel
        nodeName='LLM'
        path={['memory', 'content', 'text']}
        varType={Type.string}
      />
      <div className='my-2 w-[404px] bg-white'>
        <ShowPanel
          payload={mockStructData}
        />
      </div>
      <PickerPanel
        root={{ nodeName: 'LLM', attrName: 'structured_output' }}
        payload={mockStructData}
        onSelect={() => { }}
      />
    </div>
  )
}
export default React.memo(Test)
