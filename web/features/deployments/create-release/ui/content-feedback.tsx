'use client'

import { useAtomValue } from 'jotai'
import { useTranslation } from '#i18n'
import { UnsupportedDslNodesAlert } from '../../shared/components/unsupported-dsl-nodes-alert'
import {
  createReleaseContentCheckFailedAtom,
  createReleaseMatchedReleaseAtom,
  createReleaseUnsupportedDslNodesAtom,
} from '../state'

export function ReleaseContentFeedback() {
  const { t } = useTranslation('deployments')
  const unsupportedDslNodes = useAtomValue(createReleaseUnsupportedDslNodesAtom)
  const matchedRelease = useAtomValue(createReleaseMatchedReleaseAtom)
  const releaseContentCheckFailed = useAtomValue(createReleaseContentCheckFailedAtom)

  return (
    <>
      <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />

      {matchedRelease && (
        <div role="alert" className="rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-3 py-2 system-sm-regular text-util-colors-warning-warning-700">
          {t('versions.releaseAlreadyExists', { name: matchedRelease.displayName })}
        </div>
      )}

      {releaseContentCheckFailed && (
        <div role="alert" className="rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 px-3 py-2 system-sm-regular text-util-colors-red-red-700">
          {t('versions.releaseContentCheckFailed')}
        </div>
      )}
    </>
  )
}
