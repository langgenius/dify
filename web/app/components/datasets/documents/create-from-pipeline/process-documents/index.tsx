import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Form from './form'
import Actions from './actions'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
  ref: React.RefObject<any>
  onProcess: () => void
  onPreview: () => void
  onSubmit: (data: Record<string, any>) => void
  onBack: () => void
}

const ProcessDocuments = ({
  dataSourceNodeId,
  onProcess,
  onPreview,
  onSubmit,
  onBack,
  ref,
}: ProcessDocumentsProps) => {
  const { initialData, configurations } = useConfigurations(dataSourceNodeId)
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
      <Actions onBack={onBack} onProcess={onProcess} />
    </div>
  )
}

export default ProcessDocuments
