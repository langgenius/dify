'use client'

import { useAtomValue } from 'jotai'
import {
  methodAtom,
} from '../../state/workflow-atoms'
import { DslUploadSection } from './dsl-upload-section'
import { SourceAppSelectionSection } from './source-app-selection-section'
import { SourceMethodSection } from './source-method-section'
import { SourceUnsupportedDslNodesSection } from './unsupported-dsl-nodes-section'

export function SourceStepContent() {
  const method = useAtomValue(methodAtom)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SourceMethodSection />
      {method === 'bindApp' && (
        <SourceAppSelectionSection />
      )}
      {method === 'importDsl' && (
        <DslUploadSection />
      )}
      <SourceUnsupportedDslNodesSection />
    </div>
  )
}
