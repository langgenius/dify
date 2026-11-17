'use client'
import type { PipelineDocument } from '@dify/contracts/api/console/rag/types.gen'
import { memo } from 'react'
import Processing from '../processing'

type StepThreeContentProps = {
  batchId: string
  documents: PipelineDocument[]
}

const StepThreeContent = ({ batchId, documents }: StepThreeContentProps) => {
  return <Processing batchId={batchId} documents={documents} />
}

export default memo(StepThreeContent)
