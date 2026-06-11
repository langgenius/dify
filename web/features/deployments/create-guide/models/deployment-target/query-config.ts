'use client'

import type { GuideMethod, WorkflowSourceApp } from '../../types'
import { useAtomValue } from 'jotai'
import { useDeployableEnvironmentsQuery } from '../../queries/target-environments'
import { useDeploymentOptionsQuery } from '../../queries/target-options'
import {
  dslReadErrorAtom,
  dslUnsupportedModeAtom,
  encodedDslContentAtom,
  hasDslContentAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import { selectedAppAtom } from '../../state/source-atoms'
import { methodAtom } from '../../state/workflow-atoms'

type DeploymentTargetQueryConfig = {
  encodedDslContent: string
  method: GuideMethod
  selectedApp?: WorkflowSourceApp
  shouldLoadDeploymentTarget: boolean
  shouldLoadDslDeploymentOptions: boolean
  shouldLoadSourceDeploymentOptions: boolean
}

function createDeploymentTargetQueryConfig({
  dslReadError,
  dslUnsupportedMode,
  hasDslContent,
  isReadingDsl,
  method,
  selectedApp,
}: {
  dslReadError: boolean
  dslUnsupportedMode: boolean
  hasDslContent: boolean
  isReadingDsl: boolean
  method: GuideMethod
  selectedApp?: WorkflowSourceApp
}) {
  const shouldLoadSourceDeploymentOptions = method === 'bindApp' && Boolean(selectedApp?.id)
  const shouldLoadDslDeploymentOptions = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !dslUnsupportedMode

  return {
    shouldLoadDeploymentTarget: shouldLoadSourceDeploymentOptions || shouldLoadDslDeploymentOptions,
    shouldLoadDslDeploymentOptions,
    shouldLoadSourceDeploymentOptions,
  }
}

function useDeploymentTargetQueryConfig(): DeploymentTargetQueryConfig {
  const method = useAtomValue(methodAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const dslUnsupportedMode = useAtomValue(dslUnsupportedModeAtom)
  const encodedDslContent = useAtomValue(encodedDslContentAtom)
  const hasDslContent = useAtomValue(hasDslContentAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const selectedApp = useAtomValue(selectedAppAtom)
  const queryConfig = createDeploymentTargetQueryConfig({
    dslReadError,
    dslUnsupportedMode,
    hasDslContent,
    isReadingDsl,
    method,
    selectedApp,
  })

  return {
    encodedDslContent,
    method,
    selectedApp,
    ...queryConfig,
  }
}

export function useCreateGuideDeploymentTargetEnabled() {
  return useDeploymentTargetQueryConfig().shouldLoadDeploymentTarget
}

export function useCreateGuideDeploymentOptionsQuery() {
  const {
    encodedDslContent,
    method,
    selectedApp,
    shouldLoadDslDeploymentOptions,
    shouldLoadSourceDeploymentOptions,
  } = useDeploymentTargetQueryConfig()

  return useDeploymentOptionsQuery({
    encodedDslContent,
    method,
    selectedApp,
    shouldLoadDslDeploymentOptions,
    shouldLoadSourceDeploymentOptions,
  })
}

export function useCreateGuideDeployableEnvironmentsQuery() {
  return useDeployableEnvironmentsQuery(useCreateGuideDeploymentTargetEnabled())
}
