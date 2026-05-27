'use client'

import type {
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type {
  BindingSelections,
  EnvironmentOption,
  GuideMethod,
  GuideStep,
} from './types'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { load as yamlLoad } from 'js-yaml'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import {
  hasMissingRequiredRuntimeCredentialBinding,
  runtimeCredentialSlotKey,
  selectedDeploymentRuntimeCredentials,
  selectedRuntimeCredentialSelections,
} from '../components/runtime-credential-bindings-utils'
import { SOURCE_APPS_PAGE_SIZE } from '../data'
import { createDeploymentIdempotencyKey } from '../idempotency'

type DslMetadata = {
  app?: {
    name?: unknown
  }
}

function hasEnvironmentId(environment?: Environment): environment is EnvironmentOption {
  return Boolean(environment?.id)
}

function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value)
  const chunkSize = 0x8000
  const chunks: string[] = []

  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))

  return btoa(chunks.join(''))
}

function dslAppName(content: string) {
  try {
    const parsed = yamlLoad(content) as DslMetadata | undefined
    const name = parsed?.app?.name

    return typeof name === 'string' ? name.trim() : ''
  }
  catch {
    return ''
  }
}

export function useCreateDeploymentGuide() {
  const { t } = useTranslation('deployments')
  const router = useRouter()
  const createInitialDeploymentFromSourceApp = useMutation(consoleQuery.enterprise.deploymentService.createInitialDeploymentFromSourceApp.mutationOptions())
  const createInitialDeploymentFromDsl = useMutation(consoleQuery.enterprise.deploymentService.createInitialDeploymentFromDsl.mutationOptions())

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
  const dslReadTokenRef = useRef(0)

  const sourceAppsQuery = useInfiniteQuery({
    ...consoleQuery.apps.list.infiniteOptions({
      input: pageParam => ({
        query: {
          page: Number(pageParam),
          limit: SOURCE_APPS_PAGE_SIZE,
          name: sourceSearchText,
        },
      }),
      getNextPageParam: lastPage => lastPage.has_more ? lastPage.page + 1 : undefined,
      initialPageParam: 1,
      placeholderData: keepPreviousData,
    }),
  })
  const sourceApps = sourceAppsQuery.data?.pages.flatMap(page => page.data) ?? []
  const effectiveSelectedApp = selectedApp ?? sourceApps[0]
  const hasDslContent = Boolean(dslContent.trim())
  const encodedDslContent = hasDslContent ? encodeUtf8Base64(dslContent) : ''
  const shouldResolveDeploymentTarget = step === 'target'
  const shouldLoadSourceDeploymentTarget = method === 'bindApp' && Boolean(effectiveSelectedApp?.id) && shouldResolveDeploymentTarget
  const shouldLoadDslDeploymentTarget = method === 'importDsl' && hasDslContent && shouldResolveDeploymentTarget
  const shouldLoadDeploymentTarget = shouldLoadSourceDeploymentTarget || shouldLoadDslDeploymentTarget

  const deployableEnvironmentsQuery = useQuery(consoleQuery.enterprise.environmentService.listDeployableEnvironments.queryOptions({
    input: {
      query: {},
    },
    enabled: shouldLoadDeploymentTarget,
  }))
  const sourceDeploymentOptionsQuery = useQuery(consoleQuery.enterprise.releaseService.getDeploymentOptionsFromSourceApp.queryOptions({
    input: {
      body: {
        sourceAppId: effectiveSelectedApp?.id ?? '',
      },
    },
    enabled: shouldLoadSourceDeploymentTarget,
  }))
  const dslDeploymentOptionsQuery = useQuery(consoleQuery.enterprise.releaseService.getDeploymentOptionsFromDsl.queryOptions({
    input: {
      body: {
        dsl: encodedDslContent,
      },
    },
    enabled: shouldLoadDslDeploymentTarget,
  }))
  const deploymentOptionsQuery = method === 'importDsl' ? dslDeploymentOptionsQuery : sourceDeploymentOptionsQuery
  const deploymentOptions = deploymentOptionsQuery.data?.options

  const environments = shouldLoadDeploymentTarget
    ? deployableEnvironmentsQuery.data?.data?.filter(hasEnvironmentId) ?? []
    : []
  const bindingSlots = shouldLoadDeploymentTarget
    ? deploymentOptions?.credentialSlots?.filter(slot => runtimeCredentialSlotKey(slot)) ?? []
    : []
  const effectiveSelectedEnvironmentId = selectedEnvironmentId || environments[0]?.id || ''
  const selectedEnvironment = environments.find(env => env.id === effectiveSelectedEnvironmentId) ?? environments[0]
  const bindingSelections = selectedRuntimeCredentialSelections(bindingSlots, manualBindingSelections)
  const requiredBindingsReady = bindingSlots.every(slot => !hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]))
  const isEnvironmentLoading = shouldLoadDeploymentTarget && (deployableEnvironmentsQuery.isLoading || (deployableEnvironmentsQuery.isFetching && !deployableEnvironmentsQuery.data))
  const isBindingLoading = shouldLoadDeploymentTarget && (deploymentOptionsQuery.isLoading || (deploymentOptionsQuery.isFetching && !deploymentOptionsQuery.data))
  const isDeploying = createInitialDeploymentFromSourceApp.isPending || createInitialDeploymentFromDsl.isPending
  const sourceName = method === 'importDsl'
    ? dslDefaultAppName || t('createGuide.dsl.defaultAppName')
    : method === 'bindApp'
      ? effectiveSelectedApp?.name ?? ''
      : ''
  const displayedInstanceName = instanceName.trim() || sourceName
  const defaultedReleaseName = t('createGuide.release.defaultName')
  const displayedReleaseName = releaseName.trim() || defaultedReleaseName
  const displayedReleaseDescription = releaseDescription.trim()
  const showTargetConfiguration = Boolean(method && step === 'target')

  function selectMethod(nextMethod: GuideMethod) {
    setMethod(nextMethod)
    setSelectedEnvironmentId('')
    setManualBindingSelections({})
  }

  function handleDslFileChange(file?: File) {
    const readToken = dslReadTokenRef.current + 1
    dslReadTokenRef.current = readToken
    setDslFile(file)
    setDslContent('')
    setDslDefaultAppName('')
    setDslReadError(false)
    setSelectedEnvironmentId('')
    setManualBindingSelections({})

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
      return Boolean(method && (method === 'importDsl' ? hasDslContent && !isReadingDsl && !dslReadError : effectiveSelectedApp?.id))
    if (step === 'release') {
      return Boolean(
        method
        && (method === 'importDsl' ? hasDslContent && !isReadingDsl && !dslReadError : effectiveSelectedApp?.id)
        && displayedInstanceName.trim()
        && displayedReleaseName.trim(),
      )
    }
    if (step === 'target') {
      const deploymentTargetReady = shouldLoadDeploymentTarget
        && !isEnvironmentLoading
        && !deployableEnvironmentsQuery.isError
        && !isBindingLoading
        && !deploymentOptionsQuery.isError
      return Boolean(
        selectedEnvironment?.id
        && deploymentTargetReady
        && requiredBindingsReady,
      )
    }
    return false
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
    if (method === 'bindApp' && (!effectiveSelectedApp?.id || isDeploying))
      return
    if (method === 'importDsl' && (!hasDslContent || isReadingDsl || dslReadError || isDeploying))
      return

    setSelectedEnvironmentId('')
    setManualBindingSelections({})
    setStep('target')
  }

  function applyReleaseDefaults() {
    const nextInstanceName = sourceName.trim()

    if (!instanceName.trim() && nextInstanceName)
      setInstanceName(nextInstanceName)
    if (!releaseName.trim())
      setReleaseName(defaultedReleaseName)
  }

  async function handleDeploy() {
    if (!selectedEnvironment?.id || isDeploying)
      return

    try {
      const missingRequiredBinding = bindingSlots.some(slot => hasMissingRequiredRuntimeCredentialBinding(slot, bindingSelections[runtimeCredentialSlotKey(slot)]))
      if (missingRequiredBinding)
        throw new Error('Missing required deployment binding.')

      const idempotencyKey = createDeploymentIdempotencyKey()
      const response = method === 'importDsl'
        ? await createInitialDeploymentFromDsl.mutateAsync({
            body: {
              dsl: encodedDslContent,
              environmentId: selectedEnvironment.id,
              appInstanceName: displayedInstanceName.trim(),
              appInstanceDescription: instanceDescription.trim() || undefined,
              releaseName: displayedReleaseName.trim(),
              releaseDescription: displayedReleaseDescription.trim() || undefined,
              credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
              idempotencyKey,
              expectedDslDigest: deploymentOptions?.dslDigest,
            },
          })
        : effectiveSelectedApp?.id
          ? await createInitialDeploymentFromSourceApp.mutateAsync({
              body: {
                sourceAppId: effectiveSelectedApp.id,
                environmentId: selectedEnvironment.id,
                appInstanceName: displayedInstanceName.trim(),
                appInstanceDescription: instanceDescription.trim() || undefined,
                releaseName: displayedReleaseName.trim(),
                releaseDescription: displayedReleaseDescription.trim() || undefined,
                credentials: selectedDeploymentRuntimeCredentials(bindingSlots, bindingSelections),
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
    catch {
      toast.error(t('createGuide.errors.deployFailed'))
    }
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
    creationSectionsProps: {
      defaultedReleaseName,
      dslFile,
      dslReadError,
      instanceDescription,
      instanceName,
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
    },
    handleBack,
    handlePrimaryAction,
    isDeploying,
    showTargetConfiguration,
    step,
    targetReviewSectionsProps: {
      bindingSelections,
      bindingSlots,
      environments,
      isBindingError: deploymentOptionsQuery.isError,
      isBindingLoading,
      isEnvironmentError: deployableEnvironmentsQuery.isError,
      isEnvironmentLoading,
      onSelectBinding: (slot: string, value: string) => {
        setManualBindingSelections(prev => ({ ...prev, [slot]: value }))
      },
      onSelectEnvironment: setSelectedEnvironmentId,
      selectedEnvironmentId: effectiveSelectedEnvironmentId,
    },
  }
}
