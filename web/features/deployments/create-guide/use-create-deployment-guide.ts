'use client'

import type {
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { EnvVarValues, EnvVarValueSelection } from '../components/env-var-bindings-utils'
import type { UnsupportedDslNode } from '../error'
import type {
  BindingSelections,
  EnvironmentOption,
  GuideMethod,
  GuideStep,
} from './types'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { keepPreviousData, skipToken, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { isWorkflowApp } from '../app-mode'
import {
  envVarSlotsWithoutLastDeploymentValues,
  envVarValuesWithDefaults,
  hasEnvVarSlotKey,
  hasMissingRequiredEnvVarValue,
  mergeEnvVarSlotMetadata,
  selectedDeploymentEnvVars,
} from '../components/env-var-bindings-utils'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../components/runtime-credential-bindings-utils'
import { DEPLOYMENT_PAGE_SIZE, SOURCE_APPS_PAGE_SIZE } from '../data'
import {
  dslAppName,
  dslEnvVarSlots,
  encodeDslContent,
  isWorkflowDsl,
} from '../dsl'
import {
  environmentDeploymentId,
  environmentMatchesIdentifier,
} from '../environment'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../error'
import { createDeploymentIdempotencyKey } from '../idempotency'

const RANDOM_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const RANDOM_SUFFIX_LENGTH = 4
const RANDOM_SUFFIX_FALLBACK_LENGTH = 6
const RANDOM_SUFFIX_MAX_ATTEMPTS = 16

function hasEnvironmentId(environment?: Environment): environment is EnvironmentOption {
  return Boolean(environment?.id)
}

function randomLetterCombination(length: number) {
  const randomValues = new Uint8Array(length)

  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(randomValues)
  }
  else {
    randomValues.forEach((_, index) => {
      randomValues[index] = Math.floor(Math.random() * 256)
    })
  }

  return Array.from(randomValues, value => RANDOM_SUFFIX_ALPHABET[value % RANDOM_SUFFIX_ALPHABET.length]).join('')
}

function availableInstanceName(baseName: string, existingNames: readonly string[]) {
  const existingNameSet = new Set(existingNames)
  if (!existingNameSet.has(baseName))
    return baseName

  for (let attempt = 0; attempt < RANDOM_SUFFIX_MAX_ATTEMPTS; attempt++) {
    const candidate = `${baseName}-${randomLetterCombination(RANDOM_SUFFIX_LENGTH)}`
    if (!existingNameSet.has(candidate))
      return candidate
  }

  return `${baseName}-${randomLetterCombination(RANDOM_SUFFIX_FALLBACK_LENGTH)}`
}

export function useCreateDeploymentGuide() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const createInitialDeployment = useMutation(consoleQuery.enterprise.deploymentService.deploy.mutationOptions())

  const [step, setStep] = useState<GuideStep>('source')
  const [method, setMethod] = useState<GuideMethod>('bindApp')
  const [sourceSearchText, setSourceSearchText] = useState('')
  const [selectedApp, setSelectedApp] = useState<App>()
  const [dslFile, setDslFile] = useState<File>()
  const [dslContent, setDslContent] = useState('')
  const [dslDefaultAppName, setDslDefaultAppName] = useState('')
  const [isReadingDsl, setIsReadingDsl] = useState(false)
  const [dslReadError, setDslReadError] = useState(false)
  const [instanceName, setInstanceName] = useState('')
  const [instanceDescription, setInstanceDescription] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const [releaseDescription, setReleaseDescription] = useState('')
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState('')
  const [manualBindingSelections, setManualBindingSelections] = useState<BindingSelections>({})
  const [envVarValues, setEnvVarValues] = useState<EnvVarValues>({})
  const [isSkippingReleaseOnly, setIsSkippingReleaseOnly] = useState(false)
  const [submissionUnsupportedDslNodes, setSubmissionUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])
  const [deploymentOptionsUnsupportedDslNodes, setDeploymentOptionsUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])
  const dslReadTokenRef = useRef(0)

  const sourceAppsQuery = useInfiniteQuery({
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          page: Number(pageParam),
          limit: SOURCE_APPS_PAGE_SIZE,
          name: sourceSearchText,
          mode: AppModeEnum.WORKFLOW,
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })
  const sourceApps = sourceAppsQuery.data?.pages.flatMap(page => page.data).filter(isWorkflowApp) ?? []
  const appInstancesQuery = useQuery({
    ...consoleQuery.enterprise.appInstanceService.listAppInstances.queryOptions({
      input: {
        query: {
          pageNumber: 1,
          resultsPerPage: DEPLOYMENT_PAGE_SIZE,
        },
      },
    }),
    placeholderData: keepPreviousData,
  })
  const effectiveSelectedApp = isWorkflowApp(selectedApp) ? selectedApp : sourceApps[0]
  const hasDslContent = Boolean(dslContent.trim())
  const dslUnsupportedMode = method === 'importDsl'
    && hasDslContent
    && !isReadingDsl
    && !dslReadError
    && !isWorkflowDsl(dslContent)
  const encodedDslContent = hasDslContent ? encodeDslContent(dslContent) : ''
  const shouldResolveDeploymentTarget = step === 'target'
  const shouldLoadSourceDeploymentOptions = method === 'bindApp' && Boolean(effectiveSelectedApp?.id)
  const shouldLoadDslDeploymentOptions = method === 'importDsl' && hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode
  const shouldLoadSourceDeploymentTarget = shouldLoadSourceDeploymentOptions && shouldResolveDeploymentTarget
  const shouldLoadDslDeploymentTarget = shouldLoadDslDeploymentOptions && shouldResolveDeploymentTarget
  const shouldLoadDeploymentTarget = shouldLoadSourceDeploymentTarget || shouldLoadDslDeploymentTarget

  const deployableEnvironmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled: shouldLoadDeploymentTarget,
  }))
  const sourceDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
      input: shouldLoadSourceDeploymentOptions && effectiveSelectedApp?.id
        ? {
            body: {
              sourceAppId: effectiveSelectedApp.id,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const dslDeploymentOptionsQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
      input: shouldLoadDslDeploymentOptions
        ? {
            body: {
              dsl: encodedDslContent,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const deploymentOptionsQuery = method === 'importDsl' ? dslDeploymentOptionsQuery : sourceDeploymentOptionsQuery
  const deploymentOptions = deploymentOptionsQuery.data?.options
  const unsupportedDslNodes = submissionUnsupportedDslNodes.length > 0
    ? submissionUnsupportedDslNodes
    : deploymentOptionsQuery.isError ? deploymentOptionsUnsupportedDslNodes : []

  useEffect(() => {
    let cancelled = false

    if (!deploymentOptionsQuery.isError)
      return

    void unsupportedDslNodeError(deploymentOptionsQuery.error).then((unsupportedError) => {
      if (cancelled)
        return

      setDeploymentOptionsUnsupportedDslNodes(unsupportedError?.nodes ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [deploymentOptionsQuery.error, deploymentOptionsQuery.isError])

  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data?.filter(hasEnvironmentId) ?? []
    : []
  const bindingSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const deploymentOptionEnvVarSourceSlots = deploymentOptions?.envVarSlots
  const deploymentOptionEnvVarSlots = shouldLoadDeploymentTarget
    ? deploymentOptionEnvVarSourceSlots?.filter(hasEnvVarSlotKey) ?? []
    : []
  const dslEnvVarSlotMetadata = method === 'importDsl' && dslContent ? dslEnvVarSlots(dslContent) : []
  const envVarSlots = envVarSlotsWithoutLastDeploymentValues(
    mergeEnvVarSlotMetadata(deploymentOptionEnvVarSlots, dslEnvVarSlotMetadata),
  )
  const effectiveEnvVarValues = envVarValuesWithDefaults(envVarValues, envVarSlots, { preferDefaultValue: true })
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => environmentMatchesIdentifier(env, effectiveSelectedEnvironmentId)) ?? environments[0]
  const bindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]))
  const requiredEnvVarsReady = envVarSlots.every(slot => !hasMissingRequiredEnvVarValue(slot, effectiveEnvVarValues))
  const isEnvironmentLoading = shouldLoadDeploymentTarget && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
  const isBindingLoading = shouldLoadDeploymentTarget && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
  const isDeploying = isSkippingReleaseOnly
    || createInitialDeployment.isPending
  const sourceName = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : method === 'bindApp'
      ? effectiveSelectedApp?.name ?? ''
      : ''
  const defaultedReleaseName = t('createGuide.release.defaultName')
  const submittedInstanceName = instanceName.trim()
  const submittedReleaseName = releaseName.trim()
  const submittedReleaseDescription = releaseDescription.trim()
  const existingInstanceNames = appInstancesQuery.data?.data?.map(appInstance => appInstance.name?.trim()).filter((name): name is string => Boolean(name)) ?? []
  const hasInstanceNameConflict = Boolean(submittedInstanceName && existingInstanceNames.includes(submittedInstanceName))
  const instanceNameError = hasInstanceNameConflict ? t('createGuide.release.instanceNameConflict') : undefined
  const isSourceReady = Boolean(method && (method === 'importDsl' ? hasDslContent && !isReadingDsl && !dslReadError && !dslUnsupportedMode : effectiveSelectedApp?.id))
  const isInitialReleaseReady = Boolean(isSourceReady && submittedInstanceName && submittedReleaseName && !hasInstanceNameConflict)
  const showTargetConfiguration = Boolean(method && step === 'target')
  const hasUnsupportedDslNodes = unsupportedDslNodes.length > 0

  function clearUnsupportedDslNodes() {
    setSubmissionUnsupportedDslNodes([])
    setDeploymentOptionsUnsupportedDslNodes([])
  }

  function selectMethod(nextMethod: GuideMethod) {
    clearUnsupportedDslNodes()
    setMethod(nextMethod)
    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    setEnvVarValues({})
  }

  function handleDslFileChange(file?: File) {
    clearUnsupportedDslNodes()
    const readToken = dslReadTokenRef.current + 1
    dslReadTokenRef.current = readToken
    setDslFile(file)
    setDslContent('')
    setDslDefaultAppName('')
    setDslReadError(false)
    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    setEnvVarValues({})

    if (!file) {
      setIsReadingDsl(false)
      return
    }

    setIsReadingDsl(true)
    void file.text()
      .then((content) => {
        if (dslReadTokenRef.current !== readToken)
          return
        setDslContent(content)
        setDslDefaultAppName(dslAppName(content))
      })
      .catch(() => {
        if (dslReadTokenRef.current !== readToken)
          return
        setDslReadError(true)
      })
      .finally(() => {
        if (dslReadTokenRef.current !== readToken)
          return
        setIsReadingDsl(false)
      })
  }

  function handleSelectMethod(nextMethod: GuideMethod) {
    selectMethod(nextMethod)
    setStep('source')
  }

  function canContinueCurrentStep() {
    if (step === 'source')
      return isSourceReady && !hasUnsupportedDslNodes
    if (step === 'release') {
      return isInitialReleaseReady && !hasUnsupportedDslNodes
    }
    if (step === 'target') {
      const deploymentTargetReady = shouldLoadDeploymentTarget
        && !isEnvironmentLoading
        && !deployableEnvironmentsQuery.isError
        && !isBindingLoading
        && !deploymentOptionsQuery.isError
        && !hasUnsupportedDslNodes
      return Boolean(
        selectedEnvironment?.id
        && deploymentTargetReady
        && requiredBindingsReady
        && requiredEnvVarsReady
        && isInitialReleaseReady,
      )
    }
    return false
  }

  function canSkipDeploymentCurrentStep() {
    return Boolean(
      step === 'target'
      && isInitialReleaseReady
      && !deploymentOptionsQuery.isError
      && !hasUnsupportedDslNodes,
    )
  }

  function handleBack() {
    if (isDeploying)
      return
    if (step === 'release')
      setStep('source')
    else if (step === 'target')
      setStep('release')
  }

  async function createReleaseArtifactsAndContinue() {
    if (method === 'bindApp' && (!effectiveSelectedApp?.id || !isWorkflowApp(effectiveSelectedApp) || isDeploying))
      return
    if (method === 'importDsl' && (!hasDslContent || isReadingDsl || dslReadError || dslUnsupportedMode || isDeploying))
      return

    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    setEnvVarValues({})
    setStep('target')
  }

  function applyReleaseDefaults() {
    const nextInstanceName = sourceName.trim()

    if (!instanceName.trim() && nextInstanceName)
      setInstanceName(availableInstanceName(nextInstanceName, existingInstanceNames))
    if (!releaseName.trim())
      setReleaseName(defaultedReleaseName)
  }

  async function createInitialReleaseOnly() {
    setIsSkippingReleaseOnly(true)

    try {
      const createdAppInstance = await consoleClient.enterprise.appInstanceService.createAppInstance({
        body: {
          name: submittedInstanceName,
          description: instanceDescription.trim() || undefined,
        },
      })
      const appInstanceId = createdAppInstance.appInstance?.id
      if (!appInstanceId)
        throw new Error('Create app instance did not return an app instance.')

      const createdRelease = method === 'importDsl'
        ? await consoleClient.enterprise.releaseService.createReleaseFromDsl({
            body: {
              appInstanceId,
              dsl: encodedDslContent,
              name: submittedReleaseName,
              description: submittedReleaseDescription || undefined,
              createAppInstance: false,
            },
          })
        : effectiveSelectedApp?.id
          ? await consoleClient.enterprise.releaseService.createReleaseFromSourceApp({
              body: {
                appInstanceId,
                sourceAppId: effectiveSelectedApp.id,
                name: submittedReleaseName,
                description: submittedReleaseDescription || undefined,
                createAppInstance: false,
              },
            })
          : undefined

      if (!createdRelease?.release?.id)
        throw new Error('Create release did not return a release.')

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    finally {
      setIsSkippingReleaseOnly(false)
    }
  }

  async function createDeploymentAndRelease({ deployToEnvironment }: {
    deployToEnvironment: boolean
  }) {
    if (isDeploying || !isInitialReleaseReady)
      return
    if (hasInstanceNameConflict)
      return
    if (deployToEnvironment && !selectedEnvironment?.id)
      return
    if (method === 'bindApp' && (!effectiveSelectedApp?.id || !isWorkflowApp(effectiveSelectedApp)))
      return
    if (method === 'importDsl' && !hasDslContent)
      return
    if (method === 'importDsl' && !isWorkflowDsl(dslContent)) {
      toast.error(t('createGuide.dsl.unsupportedMode'))
      return
    }

    setSubmissionUnsupportedDslNodes([])
    try {
      if (!deployToEnvironment) {
        await createInitialReleaseOnly()
        return
      }

      const targetEnvironmentId = await resolveSelectedDeploymentEnvironmentId()
      if (!targetEnvironmentId) {
        toast.error(t('createGuide.errors.deployFailed'))
        return
      }

      const missingRequiredBinding = bindingSlots.some(slot => hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]))
      if (missingRequiredBinding)
        throw new Error('Missing required deployment binding.')
      const missingRequiredEnvVar = envVarSlots.some(slot => hasMissingRequiredEnvVarValue(slot, effectiveEnvVarValues))
      if (missingRequiredEnvVar)
        throw new Error('Missing required deployment environment variable.')

      const idempotencyKey = createDeploymentIdempotencyKey()
      const response = method === 'importDsl'
        ? await createInitialDeployment.mutateAsync({
            body: {
              dsl: encodedDslContent,
              new: {
                name: submittedInstanceName,
                description: instanceDescription.trim() || undefined,
              },
              environmentId: targetEnvironmentId,
              releaseName: submittedReleaseName,
              releaseDescription: submittedReleaseDescription || undefined,
              credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
              envVars: selectedDeploymentEnvVars(envVarSlots, effectiveEnvVarValues),
              idempotencyKey,
              expectedDslDigest: deploymentOptions?.dslDigest,
            },
          })
        : effectiveSelectedApp?.id
          ? await createInitialDeployment.mutateAsync({
              body: {
                sourceAppId: effectiveSelectedApp.id,
                new: {
                  name: submittedInstanceName,
                  description: instanceDescription.trim() || undefined,
                },
                environmentId: targetEnvironmentId,
                releaseName: submittedReleaseName,
                releaseDescription: submittedReleaseDescription || undefined,
                credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
                envVars: selectedDeploymentEnvVars(envVarSlots, effectiveEnvVarValues),
                idempotencyKey,
                expectedDslDigest: deploymentOptions?.dslDigest,
              },
            })
          : undefined
      const appInstanceId = response?.appInstance?.id ?? response?.release?.appInstanceId
      if (!appInstanceId)
        throw new Error('Create initial deployment did not return an app instance.')

      router.push(`/deployments/${appInstanceId}/overview`)
    }
    catch (error) {
      const unsupportedError = await unsupportedDslNodeError(error)
      if (unsupportedError?.nodes.length) {
        setSubmissionUnsupportedDslNodes(unsupportedError.nodes)
        return
      }

      const fallbackMessage = t(deployToEnvironment ? 'createGuide.errors.deployFailed' : 'createGuide.errors.createReleaseFailed')
      toast.error(await deploymentErrorMessage(error) || fallbackMessage)
    }
  }

  async function handleDeploy() {
    await createDeploymentAndRelease({ deployToEnvironment: true })
  }

  async function handleSkipDeployment() {
    if (!canSkipDeploymentCurrentStep())
      return

    await createDeploymentAndRelease({ deployToEnvironment: false })
  }

  async function resolveSelectedDeploymentEnvironmentId() {
    const currentEnvironmentId = environmentDeploymentId(selectedEnvironment)
    if (currentEnvironmentId)
      return currentEnvironmentId

    const selectedEnvironmentIdentifier = selectedEnvironmentId || selectedEnvironment?.id || selectedEnvironment?.name || ''
    const selectedEnvironmentName = selectedEnvironment?.name || ''
    const freshResult = await deployableEnvironmentsQuery.refetch()
    const freshEnvironments = freshResult.data?.data?.filter(hasEnvironmentId) ?? []
    const freshSelectedEnvironment = freshEnvironments.find(environment => (
      environmentMatchesIdentifier(environment, selectedEnvironmentIdentifier)
      || (selectedEnvironmentName && environment.name === selectedEnvironmentName)
    )) ?? freshEnvironments[0]

    return environmentDeploymentId(freshSelectedEnvironment)
  }

  function handlePrimaryAction() {
    if (!canContinueCurrentStep())
      return

    if (step === 'source') {
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
      applyReleaseDefaults()
      setStep('release')
      return
    }
    if (step === 'release') {
      if (method === 'bindApp' && effectiveSelectedApp)
        setSelectedApp(effectiveSelectedApp)
      void createReleaseArtifactsAndContinue()
      return
    }
    if (step === 'target') {
      void handleDeploy()
    }
  }

  return {
    canContinue: canContinueCurrentStep(),
    canSkipDeployment: canSkipDeploymentCurrentStep(),
    creationSectionsProps: {
      defaultedReleaseName,
      dslFile,
      dslReadError,
      dslUnsupportedMode,
      instanceDescription,
      instanceName,
      instanceNameError,
      isReadingDsl,
      method,
      onDslFileChange: handleDslFileChange,
      onInstanceDescriptionChange: (value: string) => {
        setInstanceDescription(value)
        setStep('release')
      },
      onInstanceNameChange: (value: string) => {
        setInstanceName(value)
        setStep('release')
      },
      onReleaseDescriptionChange: (value: string) => {
        setReleaseDescription(value)
        setStep('release')
      },
      onReleaseNameChange: (value: string) => {
        setReleaseName(value)
        setStep('release')
      },
      onSearchTextChange: setSourceSearchText,
      onSelectMethod: handleSelectMethod,
      onSelectSourceApp: (app: App) => {
        if (!isWorkflowApp(app))
          return
        clearUnsupportedDslNodes()
        setSelectedApp(app)
      },
      releaseDescription,
      releaseName,
      selectedApp: effectiveSelectedApp,
      sourceApps,
      sourceAppsLoading: sourceAppsQuery.isLoading || (sourceAppsQuery.isFetching && sourceApps.length === 0),
      sourceName,
      sourceSearchText,
      stage: step === 'release' ? 'release' as const : 'source' as const,
      unsupportedDslNodes,
    },
    handleBack,
    handlePrimaryAction,
    handleSkipDeployment,
    isDeploying,
    isSkippingDeployment: isSkippingReleaseOnly,
    showTargetConfiguration,
    step,
    targetReviewSectionsProps: {
      bindingSelections,
      bindingSlots,
      environments,
      envVarSlots,
      envVarValues: effectiveEnvVarValues,
      isBindingError: deploymentOptionsQuery.isError,
      isBindingLoading,
      isEnvironmentError: deployableEnvironmentsQuery.isError,
      isEnvironmentLoading,
      onSelectBinding: (slot: string, value: string) => {
        setManualBindingSelections(prev => ({ ...prev, [slot]: value }))
      },
      onSelectEnvironment: setSelectedEnvironmentId,
      onSetEnvVar: (key: string, value: EnvVarValueSelection) => {
        setEnvVarValues(prev => ({ ...prev, [key]: value }))
      },
      selectedEnvironmentId: effectiveSelectedEnvironmentId,
      unsupportedDslNodes,
    },
  }
}
