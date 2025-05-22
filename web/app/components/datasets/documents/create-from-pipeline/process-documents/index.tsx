import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Options from './options'
import Actions from './actions'
import { useCallback, useRef } from 'react'
import Header from './header'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
  onProcess: (data: Record<string, any>) => void
  onPreview: (data: Record<string, any>) => void
  onBack: () => void
}

const ProcessDocuments = ({
  dataSourceNodeId,
  onProcess,
  onPreview,
  onBack,
}: ProcessDocumentsProps) => {
  const formRef = useRef<any>(null)
  const isPreview = useRef(false)
  const { initialData, configurations } = useConfigurations(dataSourceNodeId)
  const schema = generateZodSchema(configurations)

  const handleProcess = useCallback(() => {
    isPreview.current = false
    formRef.current?.submit()
  }, [])

  const handlePreview = useCallback(() => {
    isPreview.current = true
    formRef.current?.submit()
  }, [])

  const handleSubmit = useCallback((data: Record<string, any>) => {
    isPreview.current ? onPreview(data) : onProcess(data)
  }, [onPreview, onProcess])

  const handleReset = useCallback(() => {
    formRef.current?.reset()
  }, [])

  return (
    <div className='flex flex-col gap-y-4 pt-4'>
      <div className='flex flex-col rounded-lg border border-components-panel-border bg-components-panel-bg'>
        <Header
          onReset={handleReset}
          disableReset={!formRef.current?.isDirty()}
          onPreview={handlePreview}
        />
        <Options
          ref={formRef}
          initialData={initialData}
          configurations={configurations}
          schema={schema}
          onSubmit={handleSubmit}
        />
      </div>
      <Actions onBack={onBack} onProcess={handleProcess} />
    </div>
  )
}

export default ProcessDocuments
