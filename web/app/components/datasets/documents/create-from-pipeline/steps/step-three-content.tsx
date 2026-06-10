'use client'
import type { InitialDocumentDetail } from '@/models/pipeline'
import { memo } from 'react'
import Processing from '../processing'

type StepThreeContentProps = {
  batchId: string
  documents: InitialDocumentDetail[]
}

const StepThreeContent = ({
  batchId,
  documents,
}: StepThreeContentProps) => {
  return (
    <Processing
      batchId={batchId}
      documents={documents}
    />
  )
}

export default memo(StepThreeContent)
