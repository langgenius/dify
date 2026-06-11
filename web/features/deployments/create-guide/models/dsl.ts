'use client'

import { useAtomValue } from 'jotai'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../state/dsl-atoms'
import { createDslState } from '../state/dsl-derived'
import { methodAtom } from '../state/workflow-atoms'

export function useCreateGuideDslModel() {
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)

  return createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })
}
