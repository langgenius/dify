import type {
  LoopVariable,
} from '@/app/components/workflow/nodes/loop/types'
import type {
  Var,
} from '@/app/components/workflow/types'
import {
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import ArrayBoolList from '@/app/components/workflow/panel/chat-variable-panel/components/array-bool-list'
import BoolValue from '@/app/components/workflow/panel/chat-variable-panel/components/bool-value'

import {
  arrayBoolPlaceholder,
  arrayNumberPlaceholder,
  arrayObjectPlaceholder,
  arrayStringPlaceholder,
  objectPlaceholder,
} from '@/app/components/workflow/panel/chat-variable-panel/utils'
import {
  ValueType,
  VarType,
} from '@/app/components/workflow/types'

type FormItemProps = {
  nodeId: string
  item: LoopVariable
  onChange: (value: any) => void
}
const FormItem = ({
  nodeId,
  item,
  onChange,
}: FormItemProps) => {
  const { t } = useTranslation()
  const { value_type, var_type, value } = item

  const handleInputChange = useCallback((e: any) => {
    onChange(e.target.value)
  }, [onChange])

  const handleChange = useCallback((value: any) => {
    onChange(value)
  }, [onChange])

  const filterVar = useCallback((variable: Var) => {
    return variable.type === var_type
  }, [var_type])

  const editorMinHeight = useMemo(() => {
    if (var_type === VarType.arrayObject)
      return '240px'
    return '120px'
  }, [var_type])
  const placeholder = useMemo(() => {
    if (var_type === VarType.arrayString)
      return arrayStringPlaceholder
    if (var_type === VarType.arrayNumber)
      return arrayNumberPlaceholder
    if (var_type === VarType.arrayObject)
      return arrayObjectPlaceholder
    if (var_type === VarType.arrayBoolean)
      return arrayBoolPlaceholder
    return objectPlaceholder
  }, [var_type])

  return (
    <div>
      {
        value_type === ValueType.variable && (
          <VarReferencePicker
            readonly={false}
            nodeId={nodeId}
            isShowNodeName
            value={value}
            onChange={handleChange}
            filterVar={filterVar}
            placeholder={t('nodes.assigner.setParameter', { ns: 'workflow' }) as string}
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.string && (
          <Textarea
            value={value}
            onChange={handleInputChange}
            className="min-h-12 w-full"
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.number && (
          <Input
            type="number"
            value={value}
            onChange={handleInputChange}
            className="w-full"
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.boolean && (
          <BoolValue
            value={value}
            onChange={handleChange}
          />
        )
      }
      {
        value_type === ValueType.constant
        && (var_type === VarType.object || var_type === VarType.arrayString || var_type === VarType.arrayNumber || var_type === VarType.arrayObject)
        && (
          <div className="w-full rounded-[10px] bg-components-input-bg-normal py-2 pl-3 pr-1" style={{ height: editorMinHeight }}>
            <CodeEditor
              value={value}
              isExpand
              noWrapper
              language={CodeLanguage.json}
              onChange={handleChange}
              className="w-full"
              placeholder={<div className="whitespace-pre">{placeholder}</div>}
            />
          </div>
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.arrayBoolean && (
          <ArrayBoolList
            className="mt-2"
            list={value || [false]}
            onChange={handleChange}
          />
        )
      }
    </div>
  )
}

export default FormItem
