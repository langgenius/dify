'use client'

import { useAtomValue } from 'jotai'
import {
  dslContentAtom,
  encodedDslContentAtom,
  hasDslContentAtom,
} from '../state/dsl-atoms'
import {
  instanceDescriptionAtom,
  submittedReleaseFieldsAtom,
} from '../state/release-atoms'
import {
  methodAtom,
} from '../state/workflow-atoms'

export function useCreateDeploymentSubmissionDraft() {
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const encodedDslContent = useAtomValue(encodedDslContentAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const instanceDescription = useAtomValue(instanceDescriptionAtom)
  const releaseFields = useAtomValue(submittedReleaseFieldsAtom)

  return {
    dslContent,
    encodedDslContent,
    hasDslContent,
    instanceDescription,
    method,
    ...releaseFields,
  }
}

export type CreateDeploymentSubmissionDraft = ReturnType<typeof useCreateDeploymentSubmissionDraft>
