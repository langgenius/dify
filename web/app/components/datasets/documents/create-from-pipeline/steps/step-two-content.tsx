'use client'
import type { RefObject } from 'react'
import { memo } from 'react'
import ProcessDocuments from '../process-documents'

type StepTwoContentProps = {
  formRef: RefObject<{ submit: () => void } | null>
  dataSourceNodeId: string
  isRunning: boolean
  onProcess: () => void
  onPreview: () => void
  onSubmit: (data: Record<string, unknown>) => void
  onBack: () => void
}

const StepTwoContent = ({
  formRef,
  dataSourceNodeId,
  isRunning,
  onProcess,
  onPreview,
  onSubmit,
  onBack,
}: StepTwoContentProps) => {
  return (
    <ProcessDocuments
      ref={formRef}
      dataSourceNodeId={dataSourceNodeId}
      isRunning={isRunning}
      onProcess={onProcess}
      onPreview={onPreview}
      onSubmit={onSubmit}
      onBack={onBack}
    />
  )
}

export default memo(StepTwoContent)
