import type { UnsupportedDslNode } from '../error'
import type { useDslFileReader } from '../use-dsl-file-reader'
import type { CreationSectionsProps } from './source-release-sections'
import type { TargetReviewSectionsProps } from './target-step'
import type { GuideMethod, GuideStep } from './types'
import type { useDeploymentGuideReleaseFields } from './use-deployment-guide-release-fields'
import type { useDeploymentGuideSource } from './use-deployment-guide-source'
import type { useDeploymentTargetOptions } from './use-deployment-target-options'
import type { App } from '@/types/app'

type CreateCreationSectionsPropsParams = {
  defaultedReleaseName: string
  dslFileReader: ReturnType<typeof useDslFileReader>
  dslUnsupportedMode: boolean
  instanceNameError?: string
  method: GuideMethod
  onDslFileChange: (file?: File) => void
  onSelectMethod: (method: GuideMethod) => void
  onSelectSourceApp: (app: App) => void
  releaseFields: ReturnType<typeof useDeploymentGuideReleaseFields>
  source: ReturnType<typeof useDeploymentGuideSource>
  sourceName: string
  step: GuideStep
  unsupportedDslNodes: UnsupportedDslNode[]
}

export function createCreationSectionsProps({
  defaultedReleaseName,
  dslFileReader,
  dslUnsupportedMode,
  instanceNameError,
  method,
  onDslFileChange,
  onSelectMethod,
  onSelectSourceApp,
  releaseFields,
  source,
  sourceName,
  step,
  unsupportedDslNodes,
}: CreateCreationSectionsPropsParams): CreationSectionsProps {
  return {
    defaultedReleaseName,
    dslFile: dslFileReader.dslFile,
    dslReadError: dslFileReader.dslReadError,
    dslUnsupportedMode,
    instanceDescription: releaseFields.instanceDescription,
    instanceName: releaseFields.instanceName,
    instanceNameError,
    isReadingDsl: dslFileReader.isReadingDsl,
    method,
    onDslFileChange,
    onInstanceDescriptionChange: releaseFields.handleInstanceDescriptionChange,
    onInstanceNameChange: releaseFields.handleInstanceNameChange,
    onReleaseDescriptionChange: releaseFields.handleReleaseDescriptionChange,
    onReleaseNameChange: releaseFields.handleReleaseNameChange,
    onSearchTextChange: source.setSourceSearchText,
    onSelectMethod,
    onSelectSourceApp,
    releaseDescription: releaseFields.releaseDescription,
    releaseName: releaseFields.releaseName,
    selectedApp: source.effectiveSelectedApp,
    sourceApps: source.sourceApps,
    sourceAppsLoading: source.sourceAppsLoading,
    sourceName,
    sourceSearchText: source.sourceSearchText,
    stage: step === 'release' ? 'release' : 'source',
    unsupportedDslNodes,
  }
}

export function createTargetReviewSectionsProps({
  targetOptions,
  unsupportedDslNodes,
}: {
  targetOptions: ReturnType<typeof useDeploymentTargetOptions>
  unsupportedDslNodes: UnsupportedDslNode[]
}): TargetReviewSectionsProps {
  return {
    bindingSelections: targetOptions.bindingSelections,
    bindingSlots: targetOptions.bindingSlots,
    environments: targetOptions.environments,
    envVarSlots: targetOptions.envVarSlots,
    envVarValues: targetOptions.envVarValues,
    isBindingError: targetOptions.deploymentOptionsQuery.isError,
    isBindingLoading: targetOptions.isBindingLoading,
    isEnvironmentError: targetOptions.deployableEnvironmentsQuery.isError,
    isEnvironmentLoading: targetOptions.isEnvironmentLoading,
    onSelectBinding: targetOptions.onSelectBinding,
    onSelectEnvironment: targetOptions.onSelectEnvironment,
    onSetEnvVar: targetOptions.onSetEnvVar,
    selectedEnvironmentId: targetOptions.effectiveSelectedEnvironmentId,
    unsupportedDslNodes,
  }
}
