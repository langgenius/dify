import React from 'react'
import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useInputVariables } from './hooks'
import Form from './form'
import Actions from './actions'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'

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
  const { isFetchingParams, paramsConfig } = useInputVariables(dataSourceNodeId)
  const initialData = useInitialData(paramsConfig?.variables || [])
  const configurations = useConfigurations(paramsConfig?.variables || [])
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
      <Actions runDisabled={isFetchingParams} onBack={onBack} onProcess={onProcess} />
    </div>
  )
}

export default React.memo(ProcessDocuments)
