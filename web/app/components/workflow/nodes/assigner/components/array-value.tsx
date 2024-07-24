'use client'
import type { FC } from 'react'
import React, { useCallback, useMemo } from 'react'
import {
  RiArrowDownSLine,
} from '@remixicon/react'
import type { ValueSelector, Var } from '../../../types'
import { VarType } from '../../../types'
import CodeEditor from '../../_base/components/editor/code-editor'
import { CodeLanguage } from '../../code/types'
import { WriteMode } from '../types'
import { arrayNumber, arrayObject, arrayString, object } from './json-example'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import TypeSelector from '@/app/components/workflow/nodes/_base/components/selector'
type Props = {
  nodeId: string
  varType: VarType
  writeMode: WriteMode
  value: {
    type: VarKindType
    value: ValueSelector | string
  }
  onChange: (value: any) => void
  readOnly: boolean
}

const varKindTypes = [
  {
    label: 'Variable',
    value: VarKindType.variable,
  },
  {
    label: 'Constant',
    value: VarKindType.constant,
  },
]

const ArrayValue: FC<Props> = ({
  nodeId,
  varType,
  writeMode,
  value,
  onChange,
  readOnly,
}) => {
  const handleValueChange = useCallback((newValue: ValueSelector | string) => {
    onChange({
      ...value,
      value: newValue,
    })
  }, [onChange, value])

  const varTypeItem = varKindTypes.find(item => item.value === value?.type)

  const handleVarKindTypeChange = useCallback((newType: VarKindType) => {
    onChange({
      value: newType === VarKindType.constant ? '' : [],
      type: newType,
    })
  }, [onChange])

  const filterVar = useCallback((varPayload: Var) => {
    return varPayload.type === varType
  }, [varType])

  const example = useMemo(() => {
    if (writeMode === WriteMode.Overwrite) {
      switch (varType) {
        case VarType.arrayString:
          return arrayString
        case VarType.arrayNumber:
          return arrayNumber
        case VarType.arrayObject:
          return arrayObject
      }
    }
    else { // Append
      if (varType === VarType.arrayObject)
        return object
    }
    return ''
  }, [varType, writeMode])

  return (
    <div>
      <TypeSelector
        className='mb-1'
        noLeft
        trigger={
          <div className='flex items-center h-7 justify-between px-2 bg-components-input-bg-normal radius-md text-xs'>
            <div className='system-sm-regular text-components-input-text-filled'>{varTypeItem?.label}</div>
            {!readOnly && <RiArrowDownSLine className='w-4 h-4 text-text-quaternary' />}
          </div>
        }
        readonly={readOnly}
        value={value.type}
        options={varKindTypes}
        onChange={handleVarKindTypeChange}
      />
      {value.type === VarKindType.constant
        ? (
          <CodeEditor
            value={value.value as string}
            onChange={handleValueChange}
            readOnly={readOnly}
            language={CodeLanguage.json}
            title={<span>JSON</span>}
            placeholder={<div className='whitespace-pre'>{`# JSON example 
${example}`}
            </div>}
          />
        )
        : (
          <VarReferencePicker
            readonly={readOnly}
            isShowNodeName
            nodeId={nodeId}
            value={value.value}
            onChange={handleValueChange}
            // onOpen={handleOpen(index)}
            defaultVarKindType={value?.type}
            filterVar={filterVar}
          />
        )}
    </div>
  )
}
export default React.memo(ArrayValue)
