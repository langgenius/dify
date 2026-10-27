'use client'

import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { knowledgeFsFeaturesQueryOptions } from './client'

const knowledgeFsFeaturesQueryAtom = atomWithQuery(() => knowledgeFsFeaturesQueryOptions())

// Every surface stays unavailable until the authenticated query resolves, and after it fails.
const knowledgeFsFeaturesAtom = atom((get) => get(knowledgeFsFeaturesQueryAtom).data)

export const knowledgeFsEnabledAtom = atom((get) => get(knowledgeFsFeaturesAtom)?.enabled ?? false)

export const knowledgeFsUploadEnabledAtom = atom(
  (get) => get(knowledgeFsFeaturesAtom)?.upload_enabled ?? false,
)

export const agentKnowledgeFsEnabledAtom = atom(
  (get) => get(knowledgeFsFeaturesAtom)?.agent_enabled ?? false,
)
