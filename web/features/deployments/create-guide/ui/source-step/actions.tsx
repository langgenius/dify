'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  dslDefaultAppNameAtom,
} from '../../state/dsl-atoms'
import {
  effectiveSelectedAppAtom,
  sourceCanGoNextAtom,
} from '../../state/guide-derived-atoms'
import {
  existingInstanceNamesAtom,
} from '../../state/query-atoms'
import { applyReleaseDefaultsAtom } from '../../state/release-atoms'
import {
  selectSourceAppAtom,
} from '../../state/source-atoms'
import {
  methodAtom,
  setStepAtom,
} from '../../state/workflow-atoms'

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const canGoNext = useAtomValue(sourceCanGoNextAtom)
  const effectiveSelectedApp = useAtomValue(effectiveSelectedAppAtom)
  const existingInstanceNames = useAtomValue(existingInstanceNamesAtom)
  const setStep = useSetAtom(setStepAtom)
  const selectSourceApp = useSetAtom(selectSourceAppAtom)
  const applyReleaseDefaults = useSetAtom(applyReleaseDefaultsAtom)
  const dslDefaultAppName = useAtomValue(dslDefaultAppNameAtom)
  const sourceName = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : effectiveSelectedApp?.name

  function handleNext() {
    if (!canGoNext)
      return

    if (method === 'bindApp' && effectiveSelectedApp)
      selectSourceApp(effectiveSelectedApp)

    applyReleaseDefaults({
      defaultReleaseName: t('createGuide.release.defaultName'),
      existingNames: existingInstanceNames,
      sourceName,
    })
    setStep('release')
  }

  return (
    <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}
