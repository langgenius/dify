'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  sourceCanGoNextAtom,
} from '../../state/source-derived-atoms'
import {
  continueFromSourceAtom,
} from '../../state/source-next-action-atoms'

export function SourceActionButtons() {
  const { t } = useTranslation('deployments')
  const canGoNext = useAtomValue(sourceCanGoNextAtom)
  const continueFromSource = useSetAtom(continueFromSourceAtom)

  function handleNext() {
    continueFromSource({
      defaultDslAppName: t('createGuide.dsl.defaultAppName'),
      defaultReleaseName: t('createGuide.release.defaultName'),
    })
  }

  return (
    <Button type="button" variant="primary" disabled={!canGoNext} onClick={handleNext}>
      {t('createGuide.actions.next')}
    </Button>
  )
}
