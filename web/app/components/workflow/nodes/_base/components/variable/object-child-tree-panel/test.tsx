'use client'
import type { FC } from 'react'
import React from 'react'
import mockStructData from '@/app/components/workflow/nodes/llm/mock-struct-data'
import PickerPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/picker'
import ShowPanel from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show'

const Test: FC = () => {
  return (
    <div className='mb-2'>
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
