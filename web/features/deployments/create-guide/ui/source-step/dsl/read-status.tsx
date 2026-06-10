'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { createDslState } from '../../../models/dsl'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../../../state/dsl-atoms'
import { methodAtom } from '../../../state/workflow-atoms'

export function DslReadStatus() {
  const { t } = useTranslation('deployments')
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })

  return (
    <>
      {isReadingDsl && (
        <div className="system-xs-regular text-text-tertiary">
          {t('createGuide.dsl.reading')}
        </div>
      )}
      {dslReadError && (
        <div className="system-xs-regular text-text-destructive">
          {t('createGuide.dsl.readFailed')}
        </div>
      )}
      {dslState.dslUnsupportedMode && (
        <div role="alert" className="system-xs-regular text-text-destructive">
          {t('createGuide.dsl.unsupportedMode')}
        </div>
      )}
    </>
  )
}
