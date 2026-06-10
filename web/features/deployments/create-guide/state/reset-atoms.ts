'use client'

import { atom } from 'jotai'
import {
  dslContentAtom,
  dslFileAtom,
  dslReadErrorAtom,
  dslReadTokenAtom,
  isReadingDslAtom,
} from './dsl-atoms'
import {
  instanceDescriptionAtom,
  instanceNameAtom,
  releaseDescriptionAtom,
  releaseNameAtom,
} from './release-atoms'
import {
  selectedAppAtom,
  sourceSearchTextAtom,
} from './source-atoms'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { clearCreateDeploymentGuideUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'
import {
  methodAtom,
  stepAtom,
} from './workflow-atoms'

export const resetGuideAtom = atom(null, (_get, set) => {
  set(stepAtom, 'source')
  set(methodAtom, 'bindApp')
  set(sourceSearchTextAtom, '')
  set(selectedAppAtom, undefined)
  set(dslFileAtom, undefined)
  set(dslContentAtom, '')
  set(isReadingDslAtom, false)
  set(dslReadErrorAtom, false)
  set(dslReadTokenAtom, 0)
  set(instanceNameAtom, '')
  set(instanceDescriptionAtom, '')
  set(releaseNameAtom, '')
  set(releaseDescriptionAtom, '')
  set(resetDeploymentTargetOptionsAtom)
  set(clearCreateDeploymentGuideUnsupportedDslNodesAtom)
})
