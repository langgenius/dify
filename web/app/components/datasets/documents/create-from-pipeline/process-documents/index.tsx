import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Options from './options'
import Actions from './actions'
import Header from './header'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
  ref: React.RefObject<any>
  onProcess: () => void
  onPreview: () => void
  onReset: () => void
  onSubmit: (data: Record<string, any>) => void
  onBack: () => void
}

const ProcessDocuments = ({
  dataSourceNodeId,
  onProcess,
  onPreview,
  onSubmit,
  onReset,
  onBack,
  ref,
}: ProcessDocumentsProps) => {
  const { initialData, configurations } = useConfigurations(dataSourceNodeId)
  const schema = generateZodSchema(configurations)

  return (
    <div className='flex flex-col gap-y-4 pt-4'>
      <div className='flex flex-col rounded-lg border border-components-panel-border bg-components-panel-bg'>
        <Header
          onReset={onReset}
          disableReset={!ref.current?.isDirty()}
          onPreview={onPreview}
        />
        <Options
          ref={ref}
          initialData={initialData}
          configurations={configurations}
          schema={schema}
          onSubmit={onSubmit}
        />
      </div>
      <Actions onBack={onBack} onProcess={onProcess} />
    </div>
  )
}

export default ProcessDocuments
