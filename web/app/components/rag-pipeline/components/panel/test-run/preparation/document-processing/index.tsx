import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'
import * as React from 'react'
import { useCallback } from 'react'
import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations, useInitialData } from '@/app/components/rag-pipeline/hooks/use-input-fields'
import Actions from './actions'
import { useInputVariables } from './hooks'
import Options from './options'

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
  const { isFetchingParams, paramsConfig } = useInputVariables(dataSourceNodeId)
  const initialData = useInitialData(paramsConfig?.variables || [])
  const configurations = useConfigurations(paramsConfig?.variables || [])
  const schema = generateZodSchema(configurations)

  const renderCustomActions = useCallback((props: CustomActionsProps) => (
    <Actions runDisabled={isFetchingParams} formParams={props} onBack={onBack} />
  ), [isFetchingParams, onBack])

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

export default React.memo(DocumentProcessing)
