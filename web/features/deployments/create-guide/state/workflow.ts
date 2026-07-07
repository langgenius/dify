'use client'

import type { WorkflowSourceApp } from './types'
import { atom } from 'jotai'
import {
  autoFilledInstanceNameAtom,
  autoFilledReleaseNameAtom,
  dslFileAtom,
  dslFileReadVersionAtom,
  effectiveMethodAtom,
  envVarValuesAtom,
  instanceNameAtom,
  manualBindingSelectionsAtom,
  methodAtom,
  releaseNameAtom,
  selectedAppAtom,
  selectedEnvironmentIdAtom,
  sourceSearchTextAtom,
  stepAtom,
  submissionUnsupportedDslNodesAtom,
} from './primitives'
import { deploymentOptionsContentCheckedAtom, existingInstanceNamesQueryAtom } from './queries'
import { dslDefaultAppNameAtom, effectiveSelectedAppAtom, importDslReadyAtom } from './source'
import { availableInstanceName, deploymentGuideMethod } from './utils'

export const sourceCanGoNextAtom = atom((get) => {
  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  const importDslReady = method === 'importDsl' && get(importDslReadyAtom)
  const bindAppReady = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)

  return (importDslReady || bindAppReady) && get(deploymentOptionsContentCheckedAtom)
})

export const setSourceSearchTextAtom = atom(null, (get, set, value: string) => {
  if (get(sourceSearchTextAtom) === value)
    return

  set(sourceSearchTextAtom, value)
  set(selectedAppAtom, undefined)
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])
})

export const selectSourceAppAtom = atom(null, (_get, set, app: WorkflowSourceApp) => {
  set(selectedAppAtom, app)
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])
})

export const continueFromSourceAtom = atom(null, (get, set, {
  defaultDslAppName,
  defaultReleaseName,
}: {
  defaultDslAppName: string
  defaultReleaseName: string
}) => {
  if (!get(sourceCanGoNextAtom))
    return

  const method = get(effectiveMethodAtom)
  const effectiveSelectedApp = get(effectiveSelectedAppAtom)
  if (method === 'bindApp' && effectiveSelectedApp)
    set(selectSourceAppAtom, effectiveSelectedApp)

  const sourceName = method === 'importDsl'
    ? get(dslDefaultAppNameAtom) || defaultDslAppName
    : effectiveSelectedApp?.name
  const nextInstanceName = sourceName?.trim()

  if (nextInstanceName) {
    const currentInstanceName = get(instanceNameAtom).trim()
    const autoFilledInstanceName = get(autoFilledInstanceNameAtom)
    const existingInstanceNamesQuery = get(existingInstanceNamesQueryAtom)
    const existingNameSet = new Set(
      existingInstanceNamesQuery.data?.pages.flatMap(page =>
        page.appInstances.flatMap((appInstance) => {
          const name = appInstance.displayName.trim()

          return name ? [name] : []
        }),
      ) ?? [],
    )

    if (!currentInstanceName || currentInstanceName === autoFilledInstanceName) {
      const nextAvailableInstanceName = availableInstanceName(nextInstanceName, existingNameSet)
      set(instanceNameAtom, nextAvailableInstanceName)
      set(autoFilledInstanceNameAtom, nextAvailableInstanceName)
    }
  }

  const currentReleaseName = get(releaseNameAtom).trim()
  const autoFilledReleaseName = get(autoFilledReleaseNameAtom)
  if (!currentReleaseName || currentReleaseName === autoFilledReleaseName) {
    set(releaseNameAtom, defaultReleaseName)
    set(autoFilledReleaseNameAtom, defaultReleaseName)
  }
  set(stepAtom, 'release')
})

export const selectDslFileAtom = atom(null, (get, set, dslFile?: File) => {
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])

  set(dslFileReadVersionAtom, get(dslFileReadVersionAtom) + 1)
  set(dslFileAtom, dslFile)
})

export const selectMethodAtom = atom(null, (_get, set, method: Parameters<typeof deploymentGuideMethod>[0]) => {
  set(methodAtom, deploymentGuideMethod(method))
  set(selectedEnvironmentIdAtom, '')
  set(manualBindingSelectionsAtom, {})
  set(envVarValuesAtom, {})
  set(submissionUnsupportedDslNodesAtom, [])
  set(stepAtom, 'source')
})
