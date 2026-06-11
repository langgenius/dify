'use client'

import { atom } from 'jotai'
import { releaseCanGoNextAtom } from './release-derived-atoms'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { stepAtom } from './workflow-atoms'

export const continueFromReleaseAtom = atom(null, (get, set) => {
  if (!get(releaseCanGoNextAtom))
    return

  set(resetDeploymentTargetOptionsAtom)
  set(stepAtom, 'target')
})
