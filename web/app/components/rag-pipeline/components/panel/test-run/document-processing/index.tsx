import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Options from './options'
import Actions from './actions'
import type { FormType } from '@/app/components/base/form'
import { useCallback } from 'react'

type DocumentProcessingProps = {
  dataSourceNodeId: string
  onProcess: (data: Record<string, any>) => void
  onBack: () => void
}

const DocumentProcessing = ({
  dataSourceNodeId,
  onProcess,
  onBack,
}: DocumentProcessingProps) => {
  const { initialData, configurations } = useConfigurations(dataSourceNodeId)
  const schema = generateZodSchema(configurations)

  const renderCustomActions = useCallback((form: FormType) => (
    <Actions form={form} onBack={onBack} />
  ), [onBack])

  return (
    <Options
      initialData={initialData}
      configurations={configurations}
      schema={schema}
      onSubmit={onProcess}
      CustomActions={renderCustomActions}
    />
  )
}

export default DocumentProcessing
