'use client'

import { useAtomValue } from 'jotai'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import { methodAtom, unsupportedDslNodesAtom } from '@/features/deployments/create-guide/state'
import { DslUploadSection } from './dsl/upload-section'
import { SourceAppSelectionSection } from './source-app/selection-section'
import { SourceMethodSection } from './source-method-section'

export function SourceStepContent() {
  const method = useAtomValue(methodAtom)
  const unsupportedDslNodes = useAtomValue(unsupportedDslNodesAtom)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SourceMethodSection />
      {method === 'bindApp' && (
        <SourceAppSelectionSection />
      )}
      {method === 'importDsl' && (
        <DslUploadSection />
      )}
      <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />
    </div>
  )
}
