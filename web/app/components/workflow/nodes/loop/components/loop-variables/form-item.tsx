import {
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import type {
  LoopVariable,
} from '@/app/components/workflow/nodes/loop/types'
import type {
  Var,
} from '@/app/components/workflow/types'
import {
  ValueType,
  VarType,
} from '@/app/components/workflow/types'

const objectPlaceholder = `#  example
#  {
#     "name": "ray",
#     "age": 20
#  }`
const arrayStringPlaceholder = `#  example
#  [
#     "value1",
#     "value2"
#  ]`
const arrayNumberPlaceholder = `#  example
#  [
#     100,
#     200
#  ]`
const arrayObjectPlaceholder = `#  example
#  [
#     {
#       "name": "ray",
#       "age": 20
#     },
#     {
#       "name": "lily",
#       "age": 18
#     }
#  ]`

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
            placeholder={t('workflow.nodes.assigner.setParameter') as string}
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.string && (
          <Textarea
            value={value}
            onChange={handleInputChange}
            className='min-h-12 w-full'
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.number && (
          <Input
            type="number"
            value={value}
            onChange={handleInputChange}
            className='w-full'
          />
        )
      }
      {
        value_type === ValueType.constant
        && (var_type === VarType.object || var_type === VarType.arrayString || var_type === VarType.arrayNumber || var_type === VarType.arrayObject)
        && (
          <div className='w-full rounded-[10px] bg-components-input-bg-normal py-2 pl-3 pr-1' style={{ height: editorMinHeight }}>
            <CodeEditor
              value={value}
              isExpand
              noWrapper
              language={CodeLanguage.json}
              onChange={handleChange}
              className='w-full'
              placeholder={<div className='whitespace-pre'>{placeholder}</div>}
            />
          </div>
        )
      }
    </div>
  )
}

export default FormItem
