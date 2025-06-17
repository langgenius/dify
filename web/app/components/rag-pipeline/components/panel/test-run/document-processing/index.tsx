import React, { useCallback } from 'react'
import { generateZodSchema } from '@/app/components/base/form/form-scenarios/base/utils'
import { useConfigurations } from './hooks'
import Options from './options'
import Actions from './actions'
import type { CustomActionsProps } from '@/app/components/base/form/components/form/actions'

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
  const { isFetchingParams, initialData, configurations } = useConfigurations(dataSourceNodeId)
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
