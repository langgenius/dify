'use client'

import type { CreateReleaseFormValues } from '../state/types'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { UnsupportedDslNodesAlert } from '../../components/unsupported-dsl-nodes-alert'
import {
  createReleaseSubmitUnsupportedDslNodesAtom,
  useCreateReleaseFormApi,
} from '../state'
import {
  useCreateReleaseSourceSelection,
  useReleaseContentCheck,
} from './use-release-content-check'

export function ReleaseContentFeedback() {
  const form = useCreateReleaseFormApi()

  return (
    <form.Subscribe selector={state => state.values}>
      {formValues => <ReleaseContentFeedbackContent formValues={formValues} />}
    </form.Subscribe>
  )
}

function ReleaseContentFeedbackContent({ formValues }: {
  formValues: CreateReleaseFormValues
}) {
  const { t } = useTranslation('deployments')
  const sourceSelection = useCreateReleaseSourceSelection(formValues)
  const releaseContent = useReleaseContentCheck(sourceSelection)
  const submitUnsupportedDslNodes = useAtomValue(createReleaseSubmitUnsupportedDslNodesAtom)
  // Precheck reports unsupported nodes at pick time; the post-submit atom stays
  // as the TOCTOU fallback when the content changes server-side between
  // precheck and create.
  const unsupportedDslNodes = releaseContent.unsupportedNodes.length > 0
    ? releaseContent.unsupportedNodes
    : submitUnsupportedDslNodes

  return (
    <>
      <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />

      {releaseContent.isCheckingReleaseContent && (
        <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-2 system-sm-regular text-text-tertiary">
          {t('versions.checkingReleaseContent')}
        </div>
      )}

      {releaseContent.matchedRelease && (
        <div role="alert" className="rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-3 py-2 system-sm-regular text-util-colors-warning-warning-700">
          {t('versions.releaseAlreadyExists', { name: releaseContent.matchedRelease.displayName })}
        </div>
      )}

      {releaseContent.releaseContentCheckFailed && (
        <div role="alert" className="rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 px-3 py-2 system-sm-regular text-util-colors-red-red-700">
          {t('versions.releaseContentCheckFailed')}
        </div>
      )}
    </>
  )
}
