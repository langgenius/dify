'use client'

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
import {
  isCreatingDeploymentAtom,
  isCreatingReleaseOnlyAtom,
} from './submission-busy-atoms'
import {
  envVarValuesAtom,
  manualBindingSelectionsAtom,
  selectedEnvironmentIdAtom,
} from './target-atoms'
import { submissionUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'
import {
  methodAtom,
  stepAtom,
} from './workflow-atoms'

export const createDeploymentGuideScopedAtoms = [
  stepAtom,
  methodAtom,
  sourceSearchTextAtom,
  selectedAppAtom,
  dslFileAtom,
  dslContentAtom,
  isReadingDslAtom,
  dslReadErrorAtom,
  dslReadTokenAtom,
  instanceNameAtom,
  instanceDescriptionAtom,
  releaseNameAtom,
  releaseDescriptionAtom,
  selectedEnvironmentIdAtom,
  manualBindingSelectionsAtom,
  envVarValuesAtom,
  submissionUnsupportedDslNodesAtom,
  isCreatingDeploymentAtom,
  isCreatingReleaseOnlyAtom,
]
