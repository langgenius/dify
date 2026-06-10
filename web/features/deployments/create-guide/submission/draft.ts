'use client'

import { useAtomValue } from 'jotai'
import {
  createDslState,
} from '../models/dsl'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
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
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const instanceDescription = useAtomValue(instanceDescriptionAtom)
  const releaseFields = useAtomValue(submittedReleaseFieldsAtom)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })

  return {
    dslContent,
    dslState,
    instanceDescription,
    method,
    ...releaseFields,
  }
}

export type CreateDeploymentSubmissionDraft = ReturnType<typeof useCreateDeploymentSubmissionDraft>
