import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { Field } from '@/app/components/workflow/nodes/_base/components/layout'

const EmbeddingModel = () => {
  const handleModelChange = () => {
    console.log('Model changed')
  }
  const handleCompletionParamsChange = () => {
    console.log('Completion parameters changed')
  }

  return (
    <Field
      fieldTitleProps={{
        title: 'Embedding Model',
      }}
    >
      <ModelParameterModal
        popupClassName='!w-[387px]'
        isInWorkflow
        isAdvancedMode={true}
        mode={'embedding'}
        provider={'openai'}
        completionParams={{}}
        modelId={'text-embedding-ada-002'}
        setModel={handleModelChange}
        onCompletionParamsChange={handleCompletionParamsChange}
        hideDebugWithMultipleModel
        debugWithMultipleModel={false}
      />
    </Field>
  )
}
export default EmbeddingModel
