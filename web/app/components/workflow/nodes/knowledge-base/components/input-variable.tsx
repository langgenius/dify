import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'

const EmbeddingModel = () => {
  const handleChange = () => {
    console.log('')
  }

  return (
    <Field
      fieldTitleProps={{
        title: 'Input Variable',
        tooltip: 'Input Variable',
      }}
    >
      <VarReferencePicker
        nodeId={''}
        isShowNodeName
        value={[]}
        onChange={handleChange}
        readonly={false}
      />
    </Field>
  )
}
export default EmbeddingModel
