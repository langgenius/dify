'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  isReadingDslAtom,
} from '../../../state/dsl-atoms'

export function DslReadStatus() {
  const { t } = useTranslation('deployments')
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)

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
      {dslUnsupportedMode && (
        <div role="alert" className="system-xs-regular text-text-destructive">
          {t('createGuide.dsl.unsupportedMode')}
        </div>
      )}
    </>
  )
}
