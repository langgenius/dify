'use client'

import { atom } from 'jotai'

export const isCreatingDeploymentAtom = atom(false)
export const isCreatingReleaseOnlyAtom = atom(false)

export const isSubmittingDeploymentGuideAtom = atom(get => (
  get(isCreatingDeploymentAtom) || get(isCreatingReleaseOnlyAtom)
))
