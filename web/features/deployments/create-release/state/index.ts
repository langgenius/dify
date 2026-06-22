'use client'

import type { UnsupportedDslNode } from '../../shared/domain/error'
import type { CreateReleaseFormValues, ReleaseSourceMode } from './types'
import { atom, useAtomValue } from 'jotai'
import { encodeDslContent, isWorkflowDsl } from '../../shared/domain/dsl'
import {
  createReleaseDslFileFieldAtom,
  createReleaseSourceAppFieldAtom,
  createReleaseSourceModeFieldAtom,
} from './use-create-release-form'

type CreateReleaseConfig = {
  appInstanceId: string
}

export type CreateReleaseDslState = {
  dslContent: string
  dslReadError: boolean
  encodedDslContent: string
  hasDslContent: boolean
  isReadingDsl: boolean
  isWorkflowDslContent: boolean
}

export const createReleaseConfigAtom = atom<CreateReleaseConfig | undefined>(undefined)
export const createReleaseDialogOpenAtom = atom(false)
export const createReleaseSubmitUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])

const createReleaseDslContentAtom = atom('')
const createReleaseDslReadErrorAtom = atom(false)
const createReleaseDslReadingAtom = atom(false)
const createReleaseDslReadTokenAtom = atom(0)

export const createReleaseLocalAtoms = [
  createReleaseDialogOpenAtom,
  createReleaseDslContentAtom,
  createReleaseDslReadErrorAtom,
  createReleaseDslReadingAtom,
  createReleaseDslReadTokenAtom,
  createReleaseSubmitUnsupportedDslNodesAtom,
] as const

export const clearCreateReleaseSubmissionErrorAtom = atom(null, (_get, set) => {
  set(createReleaseSubmitUnsupportedDslNodesAtom, [])
})

export const resetCreateReleaseDslFileAtom = atom(null, (get, set) => {
  set(createReleaseDslReadTokenAtom, get(createReleaseDslReadTokenAtom) + 1)
  set(createReleaseDslContentAtom, '')
  set(createReleaseDslReadingAtom, false)
  set(createReleaseDslReadErrorAtom, false)
})

export const openCreateReleaseDialogAtom = atom(null, (_get, set) => {
  set(clearCreateReleaseSubmissionErrorAtom)
  set(resetCreateReleaseDslFileAtom)
  set(createReleaseDialogOpenAtom, true)
})

export const closeCreateReleaseDialogAtom = atom(null, (_get, set) => {
  set(createReleaseDialogOpenAtom, false)
  set(clearCreateReleaseSubmissionErrorAtom)
  set(resetCreateReleaseDslFileAtom)
})

export const selectCreateReleaseDslFileAtom = atom(null, async (get, set, file?: File) => {
  const readToken = get(createReleaseDslReadTokenAtom) + 1
  set(createReleaseDslReadTokenAtom, readToken)
  set(createReleaseDslContentAtom, '')
  set(createReleaseDslReadingAtom, false)
  set(createReleaseDslReadErrorAtom, false)

  if (!file)
    return

  set(createReleaseDslReadingAtom, true)
  try {
    const content = await file.text()
    if (get(createReleaseDslReadTokenAtom) !== readToken)
      return

    set(createReleaseDslContentAtom, content)
  }
  catch {
    if (get(createReleaseDslReadTokenAtom) !== readToken)
      return

    set(createReleaseDslReadErrorAtom, true)
  }
  finally {
    if (get(createReleaseDslReadTokenAtom) === readToken)
      set(createReleaseDslReadingAtom, false)
  }
})

export const selectCreateReleaseSourceModeAtom = atom(null, (_get, set, releaseSourceMode: ReleaseSourceMode) => {
  set(clearCreateReleaseSubmissionErrorAtom)
  set(createReleaseSourceModeFieldAtom, releaseSourceMode)

  if (releaseSourceMode === 'sourceApp') {
    set(createReleaseDslFileFieldAtom, undefined)
    set(resetCreateReleaseDslFileAtom)
    return
  }

  set(createReleaseSourceAppFieldAtom, undefined)
})

export const updateCreateReleaseSourceAppAtom = atom(null, (_get, set, sourceApp: CreateReleaseFormValues['sourceApp']) => {
  set(createReleaseSourceAppFieldAtom, sourceApp)
  set(clearCreateReleaseSubmissionErrorAtom)
})

export const updateCreateReleaseDslFileAtom = atom(null, (get, set, dslFile: CreateReleaseFormValues['dslFile']) => {
  set(createReleaseDslFileFieldAtom, dslFile)
  set(clearCreateReleaseSubmissionErrorAtom)
  return set(selectCreateReleaseDslFileAtom, dslFile)
})

export const createReleaseDslStateAtom = atom((get): CreateReleaseDslState => {
  const dslContent = get(createReleaseDslContentAtom)
  const hasDslContent = Boolean(dslContent.trim())
  const isWorkflowDslContent = hasDslContent ? isWorkflowDsl(dslContent) : false

  return {
    dslContent,
    dslReadError: get(createReleaseDslReadErrorAtom),
    encodedDslContent: hasDslContent && isWorkflowDslContent ? encodeDslContent(dslContent) : '',
    hasDslContent,
    isReadingDsl: get(createReleaseDslReadingAtom),
    isWorkflowDslContent,
  }
})

export function useCreateReleaseConfig() {
  const config = useAtomValue(createReleaseConfigAtom)
  if (!config)
    throw new Error('Missing create release config.')

  return config
}
