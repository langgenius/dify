import { useTranslation } from 'react-i18next'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'

type FormItemProps = {
  nodeId: string
}
const FormItem = ({
  nodeId,
}: FormItemProps) => {
  const { t } = useTranslation()

  return (
    <div>
      <VarReferencePicker
        readonly={false}
        nodeId={nodeId}
        isShowNodeName
        value={''}
        onChange={() => {}}
        placeholder={t('workflow.nodes.assigner.setParameter') as string}
      />
      <Input
        type="number"
        value={''}
        onChange={() => {}}
        className='w-full'
      />
      <Textarea
        value={''}
        onChange={() => {}}
        className='w-full'
      />
      <CodeEditor
        value={''}
        language={CodeLanguage.json}
        onChange={() => {}}
        className='w-full'
      />
    </div>
  )
}

export default FormItem
