import * as React from 'react'
import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'
import Actions from './actions'
import Form from './form'
import { useInputVariables } from './hooks'

type ProcessDocumentsProps = {
  dataSourceNodeId: string
  ref: React.RefObject<any>
  isRunning: boolean
  onProcess: () => void
  onPreview: () => void
  onSubmit: (data: Record<string, any>) => void
  onBack: () => void
}

const ProcessDocuments = ({
  dataSourceNodeId,
  isRunning,
  onProcess,
  onPreview,
  onSubmit,
  onBack,
  ref,
}: ProcessDocumentsProps) => {
  const { isFetchingParams, paramsConfig } = useInputVariables(dataSourceNodeId)
  const initialData = useInitialData(paramsConfig?.variables || [])
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
      <Actions runDisabled={isFetchingParams || isRunning} onBack={onBack} onProcess={onProcess} />
    </div>
  )
}

export default React.memo(ProcessDocuments)
