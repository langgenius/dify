'use client'
import type { FC } from 'react'
import React from 'react'
import type { Field, StructuredOutput, TypeWithArray } from '../../../llm/types'
import { Type } from '../../../llm/types'
import { PickerPanelMain as Panel } from '@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/picker'
import BlockIcon from '@/app/components/workflow/block-icon'
import { BlockEnum } from '@/app/components/workflow/types'

type Props = {
  nodeName: string
  path: string[]
  varType: TypeWithArray
  nodeType?: BlockEnum
}

const VarFullPathPanel: FC<Props> = ({
  nodeName,
  path,
  varType,
  nodeType = BlockEnum.LLM,
}) => {
  const schema: StructuredOutput = (() => {
    const schema: StructuredOutput['schema'] = {
      type: Type.object,
      properties: {} as { [key: string]: Field },
      required: [],
      additionalProperties: false,
    }
    let current = schema
    for (let i = 1; i < path.length; i++) {
      const isLast = i === path.length - 1
      const name = path[i]
      current.properties[name] = {
        type: isLast ? varType : Type.object,
        properties: {},
      } as Field
      current = current.properties[name] as { type: Type.object; properties: { [key: string]: Field; }; required: never[]; additionalProperties: false; }
    }
    return {
      schema,
    }
  })()
  return (
    <div className='w-[280px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur pb-0 shadow-lg backdrop-blur-[5px]'>
      <div className='flex space-x-1 border-b-[0.5px] border-divider-subtle p-3 pb-2 '>
        <BlockIcon size='xs' type={nodeType} />
        <div className='system-xs-medium w-0 grow truncate text-text-secondary'>{nodeName}</div>
      </div>
      <Panel
        className='px-1 pb-3 pt-2'
        root={{ attrName: path[0] }}
        payload={schema}
        readonly
      />
    </div>
  )
}
export default React.memo(VarFullPathPanel)
