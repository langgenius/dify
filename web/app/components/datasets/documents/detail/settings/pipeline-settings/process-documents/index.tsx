import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'
import Form from '../../../../create-from-pipeline/process-documents/form'
import Actions from './actions'
import { useInputVariables } from './hooks'

type ProcessDocumentsProps = {
  datasourceNodeId: string
  lastRunInputData: Record<string, any>
  isRunning: boolean
  ref: React.RefObject<any>
  onProcess: () => void
  onPreview: () => void
  onSubmit: (data: Record<string, any>) => void
}

const ProcessDocuments = ({
  datasourceNodeId,
  lastRunInputData,
  isRunning,
  onProcess,
  onPreview,
  onSubmit,
  ref,
}: ProcessDocumentsProps) => {
  const { isFetchingParams, paramsConfig } = useInputVariables(datasourceNodeId)
  const initialData = useInitialData(paramsConfig?.variables || [], lastRunInputData)
  const configurations = useConfigurations(paramsConfig?.variables || [])
  const schema = generateZodSchema(configurations)

  return (
    <div className="flex flex-col gap-y-4 pt-4">
      <Form
        ref={ref}
        initialData={initialData}
        configurations={configurations}
        schema={schema}
        onSubmit={onSubmit}
        onPreview={onPreview}
        isRunning={isRunning}
      />
      <Actions runDisabled={isFetchingParams || isRunning} onProcess={onProcess} />
    </div>
  )
}

export default ProcessDocuments
