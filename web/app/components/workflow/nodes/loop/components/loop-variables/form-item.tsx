import { useTranslation } from 'react-i18next'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import type {
  LoopVariable,
} from '@/app/components/workflow/nodes/loop/types'
import {
  ValueType,
  VarType,
} from '@/app/components/workflow/types'

type FormItemProps = {
  nodeId: string
  item: LoopVariable
}
const FormItem = ({
  nodeId,
  item,
}: FormItemProps) => {
  const { t } = useTranslation()
  const { value_type, var_type, value } = item

  return (
    <div>
      {
        value_type === ValueType.variable && (
          <VarReferencePicker
            readonly={false}
            nodeId={nodeId}
            isShowNodeName
            value={''}
            onChange={() => {}}
            placeholder={t('workflow.nodes.assigner.setParameter') as string}
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.string && (
          <Textarea
            value={value}
            onChange={() => {}}
            className='w-full'
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.number && (
          <Input
            type="number"
            value={value}
            onChange={() => {}}
            className='w-full'
          />
        )
      }
      {
        value_type === ValueType.constant && var_type === VarType.object && (
          <CodeEditor
            value={value}
            language={CodeLanguage.json}
            onChange={() => {}}
            className='w-full'
          />
        )
      }
    </div>
  )
}

export default FormItem
