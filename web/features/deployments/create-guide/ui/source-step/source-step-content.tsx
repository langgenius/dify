'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { UnsupportedDslNodesAlert } from '@/features/deployments/components/unsupported-dsl-nodes-alert'
import {
  continueFromSourceAtom,
  methodAtom,
  sourceCanGoNextAtom,
  unsupportedDslNodesAtom,
} from '@/features/deployments/create-guide/state'
import { DslUploadSection } from './dsl-upload-section'
import { SourceAppSelectionSection } from './source-app-selection-section'
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

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(sourceCanGoNextAtom)
  const continueFromSource = useSetAtom(continueFromSourceAtom)

  return (
    <Button
      type="button"
      variant="primary"
      disabled={!canGoNext}
      onClick={() => continueFromSource({
        defaultDslAppName: t('createGuide.dsl.defaultAppName'),
        defaultReleaseName: t('createGuide.release.defaultName'),
      })}
    >
      {t('createGuide.actions.next')}
    </Button>
  )
}
