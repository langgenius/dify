import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Options from './options'
import Actions from './actions'
import { useCallback, useRef } from 'react'
import Header from './header'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
  onProcess: (data: Record<string, any>) => void
  onBack: () => void
}

const ProcessDocuments = ({
  dataSourceNodeId,
  onProcess,
  onBack,
}: ProcessDocumentsProps) => {
  const formRef = useRef<any>(null)
  const { initialData, configurations } = useConfigurations(dataSourceNodeId)
  const schema = generateZodSchema(configurations)

  const handleProcess = useCallback(() => {
    formRef.current?.submit()
  }, [])

  const handlePreview = useCallback(() => {
    formRef.current?.submit()
  }, [])

  const handleReset = useCallback(() => {
    formRef.current?.reset()
  }, [])

  return (
    <div className='flex flex-col gap-y-4 pt-4'>
      <div className='flex flex-col rounded-lg border-components-panel-border bg-components-panel-bg'>
        <Header
          onReset={handleReset}
          disableReset={formRef.current.isDirty()}
          onPreview={handlePreview}
        />
        <Options
          ref={formRef}
          initialData={initialData}
          configurations={configurations}
          schema={schema}
          onSubmit={onProcess}
        />
      </div>
      <Actions onBack={onBack} onProcess={handleProcess} />
    </div>
  )
}

export default ProcessDocuments
