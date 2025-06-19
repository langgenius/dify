import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Actions from './actions'
import Form from '../../../../create-from-pipeline/process-documents/form'

type ProcessDocumentsProps = {
  datasourceNodeId: string
  lastRunInputData: Record<string, any>
  ref: React.RefObject<any>
  onProcess: () => void
  onPreview: () => void
  onSubmit: (data: Record<string, any>) => void
}

const ProcessDocuments = ({
  datasourceNodeId,
  lastRunInputData,
  onProcess,
  onPreview,
  onSubmit,
  ref,
}: ProcessDocumentsProps) => {
  const { isFetchingParams, initialData, configurations } = useConfigurations(lastRunInputData, datasourceNodeId)
  const schema = generateZodSchema(configurations)

  return (
    <div className='flex flex-col gap-y-4 pt-4'>
      <Form
        ref={ref}
        initialData={initialData}
        configurations={configurations}
        schema={schema}
        onSubmit={onSubmit}
        onPreview={onPreview}
      />
      <Actions runDisabled={isFetchingParams} onProcess={onProcess} />
    </div>
  )
}

export default ProcessDocuments
