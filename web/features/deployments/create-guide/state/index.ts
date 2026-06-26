'use client'

import {
  dslFileAtom as dslFileAtomValue,
  effectiveMethodAtom as effectiveMethodAtomValue,
  envVarValuesAtom as envVarValuesAtomValue,
  instanceDescriptionAtom as instanceDescriptionAtomValue,
  instanceNameAtom as instanceNameAtomValue,
  isCreatingReleaseOnlyAtom as isCreatingReleaseOnlyAtomValue,
  isSubmittingDeploymentGuideAtom as isSubmittingDeploymentGuideAtomValue,
  methodAtom as methodAtomValue,
  releaseDescriptionAtom as releaseDescriptionAtomValue,
  releaseNameAtom as releaseNameAtomValue,
  selectedAppAtom as selectedAppAtomValue,
  selectedEnvironmentIdAtom as selectedEnvironmentIdAtomValue,
  sourceSearchTextAtom as sourceSearchTextAtomValue,
  stepAtom as stepAtomValue,
} from './primitives'
import {
  deployableEnvironmentsQueryAtom as deployableEnvironmentsQueryAtomValue,
  deploymentOptionsQueryAtom as deploymentOptionsQueryAtomValue,
  unsupportedDslNodesAtom as unsupportedDslNodesAtomValue,
} from './queries'
import {
  continueFromReleaseAtom as continueFromReleaseAtomValue,
  hasInstanceNameConflictAtom as hasInstanceNameConflictAtomValue,
  releaseCanGoNextAtom as releaseCanGoNextAtomValue,
  setInstanceDescriptionAtom as setInstanceDescriptionAtomValue,
  setInstanceNameAtom as setInstanceNameAtomValue,
  setReleaseDescriptionAtom as setReleaseDescriptionAtomValue,
  setReleaseNameAtom as setReleaseNameAtomValue,
} from './release'
import { createDeploymentGuideScopedAtoms as createDeploymentGuideScopedAtomsValue } from './scoped'
import {
  dslDefaultAppNameAtom as dslDefaultAppNameAtomValue,
  dslReadErrorAtom as dslReadErrorAtomValue,
  dslUnsupportedModeAtom as dslUnsupportedModeAtomValue,
  effectiveSelectedAppAtom as effectiveSelectedAppAtomValue,
  isReadingDslAtom as isReadingDslAtomValue,
  sourceAppsQueryAtom as sourceAppsQueryAtomValue,
} from './source'
import {
  createDeploymentGuideSubmissionAtom as createDeploymentGuideSubmissionAtomValue,
  CreateDeploymentGuideSubmissionBlockedError as CreateDeploymentGuideSubmissionBlockedErrorValue,
} from './submission'
import {
  canDeployAtom as canDeployAtomValue,
  canSkipDeploymentAtom as canSkipDeploymentAtomValue,
  deployableEnvironmentsAtom as deployableEnvironmentsAtomValue,
  deploymentTargetBindingSelectionsAtom as deploymentTargetBindingSelectionsAtomValue,
  deploymentTargetBindingSlotsAtom as deploymentTargetBindingSlotsAtomValue,
  deploymentTargetEnvVarSlotsAtom as deploymentTargetEnvVarSlotsAtomValue,
  effectiveSelectedEnvironmentIdAtom as effectiveSelectedEnvironmentIdAtomValue,
  selectBindingAtom as selectBindingAtomValue,
  setEnvVarAtom as setEnvVarAtomValue,
} from './target'
import {
  continueFromSourceAtom as continueFromSourceAtomValue,
  selectDslFileAtom as selectDslFileAtomValue,
  selectMethodAtom as selectMethodAtomValue,
  selectSourceAppAtom as selectSourceAppAtomValue,
  setSourceSearchTextAtom as setSourceSearchTextAtomValue,
  sourceCanGoNextAtom as sourceCanGoNextAtomValue,
} from './workflow'

export type GuideMethod = import('./types').GuideMethod
export type GuideStep = import('./types').GuideStep
export type WorkflowSourceApp = import('./types').WorkflowSourceApp

export const stepAtom = stepAtomValue
export const methodAtom = methodAtomValue
export const effectiveMethodAtom = effectiveMethodAtomValue
export const sourceSearchTextAtom = sourceSearchTextAtomValue
export const selectedAppAtom = selectedAppAtomValue
export const dslFileAtom = dslFileAtomValue
export const isReadingDslAtom = isReadingDslAtomValue
export const dslReadErrorAtom = dslReadErrorAtomValue
export const dslDefaultAppNameAtom = dslDefaultAppNameAtomValue
export const dslUnsupportedModeAtom = dslUnsupportedModeAtomValue
export const instanceNameAtom = instanceNameAtomValue
export const instanceDescriptionAtom = instanceDescriptionAtomValue
export const releaseNameAtom = releaseNameAtomValue
export const releaseDescriptionAtom = releaseDescriptionAtomValue
export const selectedEnvironmentIdAtom = selectedEnvironmentIdAtomValue
export const envVarValuesAtom = envVarValuesAtomValue
export const isCreatingReleaseOnlyAtom = isCreatingReleaseOnlyAtomValue
export const isSubmittingDeploymentGuideAtom = isSubmittingDeploymentGuideAtomValue
export const sourceAppsQueryAtom = sourceAppsQueryAtomValue
export const effectiveSelectedAppAtom = effectiveSelectedAppAtomValue
export const deployableEnvironmentsQueryAtom = deployableEnvironmentsQueryAtomValue
export const deploymentOptionsQueryAtom = deploymentOptionsQueryAtomValue
export const unsupportedDslNodesAtom = unsupportedDslNodesAtomValue
export const sourceCanGoNextAtom = sourceCanGoNextAtomValue
export const setSourceSearchTextAtom = setSourceSearchTextAtomValue
export const selectSourceAppAtom = selectSourceAppAtomValue
export const continueFromSourceAtom = continueFromSourceAtomValue
export const selectDslFileAtom = selectDslFileAtomValue
export const hasInstanceNameConflictAtom = hasInstanceNameConflictAtomValue
export const releaseCanGoNextAtom = releaseCanGoNextAtomValue
export const setInstanceNameAtom = setInstanceNameAtomValue
export const setInstanceDescriptionAtom = setInstanceDescriptionAtomValue
export const setReleaseNameAtom = setReleaseNameAtomValue
export const setReleaseDescriptionAtom = setReleaseDescriptionAtomValue
export const continueFromReleaseAtom = continueFromReleaseAtomValue
export const deployableEnvironmentsAtom = deployableEnvironmentsAtomValue
export const effectiveSelectedEnvironmentIdAtom = effectiveSelectedEnvironmentIdAtomValue
export const deploymentTargetBindingSlotsAtom = deploymentTargetBindingSlotsAtomValue
export const deploymentTargetBindingSelectionsAtom = deploymentTargetBindingSelectionsAtomValue
export const deploymentTargetEnvVarSlotsAtom = deploymentTargetEnvVarSlotsAtomValue
export const canDeployAtom = canDeployAtomValue
export const canSkipDeploymentAtom = canSkipDeploymentAtomValue
export const selectBindingAtom = selectBindingAtomValue
export const setEnvVarAtom = setEnvVarAtomValue
export const selectMethodAtom = selectMethodAtomValue
export const CreateDeploymentGuideSubmissionBlockedError = CreateDeploymentGuideSubmissionBlockedErrorValue
export const createDeploymentGuideSubmissionAtom = createDeploymentGuideSubmissionAtomValue
export const createDeploymentGuideScopedAtoms = createDeploymentGuideScopedAtomsValue
