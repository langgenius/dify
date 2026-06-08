import type { CreateReleaseReply } from '@dify/contracts/enterprise/types.gen'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { UnsupportedDslNode } from '../../error'
import type { ReleaseSourceMode } from './create-release-form-sections'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { isWorkflowApp } from '../../app-mode'
import { encodeDslContent, isWorkflowDsl } from '../../dsl'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../../error'
import { releaseLabel } from '../../release'
import { useDslFileReader } from '../../use-dsl-file-reader'
import { workflowSourceAppPickerValue } from './source-app-picker'

const DEFAULT_RELEASE_SOURCE_MODE: ReleaseSourceMode = 'sourceApp'
const DEFAULT_SOURCE_RELEASE_PAGE_SIZE = 1

export function useCreateReleaseControl(appInstanceId: string) {
  const { t } = useTranslation('deployments')
  const createReleaseFromSourceApp = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const createReleaseFromDsl = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions())
  const [isCreating, setIsCreating] = useState(false)
  const [releaseSourceMode, setReleaseSourceMode] = useState<ReleaseSourceMode>(DEFAULT_RELEASE_SOURCE_MODE)
  const [sourceApp, setSourceApp] = useState<App>()
  const [releaseName, setReleaseName] = useState('')
  const [releaseNameTouched, setReleaseNameTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [unsupportedDslNodes, setUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])
  const {
    dslContent,
    dslFile,
    dslReadError,
    isReadingDsl,
    resetDslFileState,
    selectDslFile,
  } = useDslFileReader()

  const latestReleaseQuery = useQuery(consoleQuery.enterprise.releaseService.listReleases.queryOptions({
    input: {
      params: { appInstanceId },
      query: {
        pageNumber: 1,
        resultsPerPage: DEFAULT_SOURCE_RELEASE_PAGE_SIZE,
      },
    },
    enabled: isCreating,
  }))
  const latestSourceAppId = latestReleaseQuery.data?.data?.[0]?.sourceAppId
  const defaultSourceAppId = isCreating && latestSourceAppId && !sourceApp ? latestSourceAppId : ''
  const defaultSourceAppQuery = useQuery(consoleQuery.apps.byAppId.get.queryOptions({
    input: defaultSourceAppId
      ? { params: { app_id: defaultSourceAppId } }
      : skipToken,
  }))
  const defaultSourceApp = latestSourceAppId
    ? workflowSourceAppPickerValue(defaultSourceAppQuery.data, latestSourceAppId)
    : undefined
  const selectedSourceApp = sourceApp ?? defaultSourceApp
  const selectedSourceAppId = selectedSourceApp && isWorkflowApp(selectedSourceApp) ? selectedSourceApp.id : undefined

  const hasDslContent = Boolean(dslContent.trim())
  const hasUnsupportedDslMode = releaseSourceMode === 'dsl' && hasDslContent && !isReadingDsl && !dslReadError && !isWorkflowDsl(dslContent)
  const canCheckSourceAppReleaseContent = isCreating && releaseSourceMode === 'sourceApp' && Boolean(selectedSourceAppId)
  const canCheckDslReleaseContent = isCreating && releaseSourceMode === 'dsl' && hasDslContent && !isReadingDsl && !dslReadError && !hasUnsupportedDslMode
  const encodedDslContent = canCheckDslReleaseContent ? encodeDslContent(dslContent) : ''
  const sourceAppReleaseContentInput = canCheckSourceAppReleaseContent && selectedSourceAppId
    ? {
        body: {
          appInstanceId,
          sourceAppId: selectedSourceAppId,
        },
      }
    : skipToken
  const sourceAppReleaseContentQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.checkReleaseContentFromSourceApp.queryOptions({
      input: sourceAppReleaseContentInput,
    }),
    retry: false,
  })
  const dslReleaseContentQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.checkReleaseContentFromDsl.queryOptions({
      input: canCheckDslReleaseContent
        ? {
            body: {
              appInstanceId,
              dsl: encodedDslContent,
            },
          }
        : skipToken,
    }),
    retry: false,
  })
  const activeReleaseContentQuery = releaseSourceMode === 'dsl' ? dslReleaseContentQuery : sourceAppReleaseContentQuery
  const canCheckReleaseContent = releaseSourceMode === 'dsl' ? canCheckDslReleaseContent : canCheckSourceAppReleaseContent
  const matchedRelease = canCheckReleaseContent ? activeReleaseContentQuery.data?.matchedRelease : undefined
  const isCheckingReleaseContent = canCheckReleaseContent && (activeReleaseContentQuery.isLoading || activeReleaseContentQuery.isFetching)
  const releaseContentCheckFailed = canCheckReleaseContent && activeReleaseContentQuery.isError
  const releaseContentReady = canCheckReleaseContent && activeReleaseContentQuery.isSuccess && !matchedRelease && !releaseContentCheckFailed
  const isCreatePending = createReleaseFromSourceApp.isPending || createReleaseFromDsl.isPending
  const isBusy = isCheckingReleaseContent || isCreatePending

  function clearCreateError() {
    setUnsupportedDslNodes([])
  }

  function closeDialog() {
    setIsCreating(false)
    setReleaseSourceMode(DEFAULT_RELEASE_SOURCE_MODE)
    setSourceApp(undefined)
    resetDslFileState()
    setReleaseName('')
    setReleaseNameTouched(false)
    setDescription('')
    clearCreateError()
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open)
      closeDialog()
    else
      setIsCreating(true)
  }

  function handleClosePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    closeDialog()
  }

  function handleCloseClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    closeDialog()
  }

  function handleSourceAppChange(app: App) {
    setSourceApp(app)
    clearCreateError()
  }

  function handleReleaseSourceModeChange(nextMode: ReleaseSourceMode) {
    if (nextMode === releaseSourceMode)
      return

    clearCreateError()
    setReleaseSourceMode(nextMode)
    if (nextMode === 'sourceApp')
      resetDslFileState()
    else
      setSourceApp(undefined)
  }

  function handleDslFileChange(file?: File) {
    clearCreateError()
    selectDslFile(file)
  }

  function handleReleaseNameBlur() {
    setReleaseNameTouched(true)
  }

  function handleReleaseNameChange(value: string) {
    setReleaseName(value)
    if (releaseNameTouched && value.trim())
      setReleaseNameTouched(false)
  }

  async function handleCreateRelease(form: HTMLFormElement) {
    if (isBusy)
      return

    const submittedReleaseName = releaseName.trim()
    const releaseDescription = description.trim()
    if (!submittedReleaseName) {
      setReleaseNameTouched(true)
      return
    }
    clearCreateError()

    const handleSuccess = (response: CreateReleaseReply) => {
      if (!response.release?.id) {
        toast.error(t('versions.createFailed'))
        return
      }
      const createdName = response.release.name || submittedReleaseName || releaseLabel(response.release)
      toast.success(t('versions.createSuccess', { name: createdName }))
      form.reset()
      closeDialog()
    }
    const handleError = async (error: unknown) => {
      const unsupportedError = await unsupportedDslNodeError(error)
      if (unsupportedError?.nodes.length) {
        setUnsupportedDslNodes(unsupportedError.nodes)
        return
      }

      const message = await deploymentErrorMessage(error)
      toast.error(message || t('versions.createFailed'))
    }

    try {
      if (releaseSourceMode === 'dsl') {
        if (!dslContent.trim() || isReadingDsl || dslReadError || !releaseContentReady)
          return
        if (!isWorkflowDsl(dslContent)) {
          toast.error(t('versions.dslUnsupportedMode'))
          return
        }

        const response = await createReleaseFromDsl.mutateAsync({
          body: {
            appInstanceId,
            dsl: encodedDslContent,
            name: submittedReleaseName,
            description: releaseDescription || undefined,
            createAppInstance: false,
          },
        })
        handleSuccess(response)
        return
      }

      if (!selectedSourceAppId)
        return
      if (!releaseContentReady)
        return

      const response = await createReleaseFromSourceApp.mutateAsync({
        body: {
          appInstanceId,
          sourceAppId: selectedSourceAppId,
          name: submittedReleaseName,
          description: releaseDescription || undefined,
          createAppInstance: false,
        },
      })
      handleSuccess(response)
    }
    catch (error) {
      await handleError(error)
    }
  }

  const hasReleaseName = Boolean(releaseName.trim())
  const releaseNameRequired = releaseNameTouched && !hasReleaseName
  const canCreateFromSourceApp = releaseSourceMode === 'sourceApp' && Boolean(selectedSourceAppId)
  const canCreateFromDsl = releaseSourceMode === 'dsl' && hasDslContent && !isReadingDsl && !dslReadError && !hasUnsupportedDslMode
  const canCreate = Boolean(hasReleaseName && releaseContentReady && !isBusy && (canCreateFromSourceApp || canCreateFromDsl))

  return {
    canCreate,
    closeDialog,
    description,
    dslFile,
    dslReadError,
    handleCloseClick,
    handleClosePointerDown,
    handleCreateRelease,
    handleDialogOpenChange,
    handleDslFileChange,
    handleReleaseNameBlur,
    handleReleaseNameChange,
    handleReleaseSourceModeChange,
    handleSourceAppChange,
    hasUnsupportedDslMode,
    isCheckingReleaseContent,
    isCreatePending,
    isCreating,
    isReadingDsl,
    matchedRelease,
    openDialog: () => setIsCreating(true),
    releaseContentCheckFailed,
    releaseName,
    releaseNameRequired,
    releaseSourceMode,
    selectedSourceApp,
    setDescription,
    unsupportedDslNodes,
  }
}
