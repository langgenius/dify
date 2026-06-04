'use client'

import type { CreateReleaseReply, ReleaseContentMatch } from '@dify/contracts/enterprise/types.gen'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { SourceAppPickerValue } from '../../components/create-instance-modal'
import type { UnsupportedDslNode } from '../../error'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { toast } from '@langgenius/dify-ui/toast'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { consoleQuery } from '@/service/client'
import { isWorkflowApp, isWorkflowAppMode } from '../../app-mode'
import { SourceAppPicker } from '../../components/create-instance-modal'
import { UnsupportedDslNodesAlert } from '../../components/unsupported-dsl-nodes-alert'
import { encodeDslContent, isWorkflowDsl } from '../../dsl'
import { deploymentErrorMessage, unsupportedDslNodeError } from '../../error'
import { releaseLabel } from '../../release'

type ReleaseSourceMode = 'sourceApp' | 'dsl'

const DESCRIPTION_MAX_LENGTH = 512
const DESCRIPTION_WARN_THRESHOLD = 460
const DEFAULT_RELEASE_SOURCE_MODE: ReleaseSourceMode = 'sourceApp'
const DEFAULT_SOURCE_RELEASE_PAGE_SIZE = 1

function selectedReleaseSourceMode(value: readonly ReleaseSourceMode[] | undefined) {
  return value?.[0]
}

function workflowSourceAppPickerValue(value: unknown, fallbackId: string): SourceAppPickerValue | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const record = value as Record<string, unknown>
  const mode = typeof record.mode === 'string' ? record.mode : undefined
  if (!isWorkflowAppMode(mode))
    return undefined

  const id = typeof record.id === 'string' && record.id ? record.id : fallbackId
  const name = typeof record.name === 'string' && record.name ? record.name : id

  return {
    id,
    name,
    mode,
  }
}

function releaseContentMatchLabel(release?: ReleaseContentMatch) {
  return release?.name || release?.releaseId || '—'
}

export function CreateReleaseControl({ appInstanceId, variant = 'primary', size = 'small', label, className }: {
  appInstanceId: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  label?: string
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const createReleaseFromSourceApp = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromSourceApp.mutationOptions())
  const createReleaseFromDsl = useMutation(consoleQuery.enterprise.releaseService.createReleaseFromDsl.mutationOptions())
  const [isCreating, setIsCreating] = useState(false)
  const [releaseSourceMode, setReleaseSourceMode] = useState<ReleaseSourceMode>(DEFAULT_RELEASE_SOURCE_MODE)
  const [sourceApp, setSourceApp] = useState<App>()
  const [dslFile, setDslFile] = useState<File>()
  const [dslContent, setDslContent] = useState('')
  const [isReadingDsl, setIsReadingDsl] = useState(false)
  const [dslReadError, setDslReadError] = useState(false)
  const [releaseName, setReleaseName] = useState('')
  const [releaseNameTouched, setReleaseNameTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [unsupportedDslNodes, setUnsupportedDslNodes] = useState<UnsupportedDslNode[]>([])
  const dslReadTokenRef = useRef(0)

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
  const encodedDslContent = useMemo(() => {
    return canCheckDslReleaseContent ? encodeDslContent(dslContent) : ''
  }, [canCheckDslReleaseContent, dslContent])
  const sourceAppReleaseContentQuery = useQuery({
    ...consoleQuery.enterprise.releaseService.checkReleaseContentFromSourceApp.queryOptions({
      input: canCheckSourceAppReleaseContent
        ? {
            body: {
              appInstanceId,
              sourceAppId: selectedSourceAppId!,
            },
          }
        : skipToken,
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

  function resetDslState() {
    dslReadTokenRef.current += 1
    setDslFile(undefined)
    setDslContent('')
    setIsReadingDsl(false)
    setDslReadError(false)
  }

  function clearCreateError() {
    setUnsupportedDslNodes([])
  }

  function closeDialog() {
    setIsCreating(false)
    setReleaseSourceMode(DEFAULT_RELEASE_SOURCE_MODE)
    setSourceApp(undefined)
    resetDslState()
    setReleaseName('')
    setReleaseNameTouched(false)
    setDescription('')
    clearCreateError()
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

  function handleReleaseSourceModeChange(nextMode: ReleaseSourceMode) {
    if (nextMode === releaseSourceMode)
      return

    clearCreateError()
    setReleaseSourceMode(nextMode)
    if (nextMode === 'sourceApp')
      resetDslState()
    else
      setSourceApp(undefined)
  }

  function handleDslFileChange(file?: File) {
    clearCreateError()
    const readToken = dslReadTokenRef.current + 1
    dslReadTokenRef.current = readToken
    setDslFile(file)
    setDslContent('')
    setIsReadingDsl(false)
    setDslReadError(false)

    if (!file)
      return

    setIsReadingDsl(true)
    void file.text()
      .then((content) => {
        if (dslReadTokenRef.current !== readToken)
          return
        setDslContent(content)
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

  const descriptionLength = description.length
  const isNearLimit = descriptionLength >= DESCRIPTION_WARN_THRESHOLD
  const hasReleaseName = Boolean(releaseName.trim())
  const releaseNameRequired = releaseNameTouched && !hasReleaseName
  const canCreateFromSourceApp = releaseSourceMode === 'sourceApp' && Boolean(selectedSourceAppId)
  const canCreateFromDsl = releaseSourceMode === 'dsl' && hasDslContent && !isReadingDsl && !dslReadError && !hasUnsupportedDslMode
  const canCreate = Boolean(hasReleaseName && releaseContentReady && !isBusy && (canCreateFromSourceApp || canCreateFromDsl))

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        disabled={isCreatePending}
        onClick={() => setIsCreating(true)}
      >
        {label ?? t('versions.createRelease')}
      </Button>

      <Dialog
        open={isCreating}
        onOpenChange={(open) => {
          if (!open)
            closeDialog()
          else
            setIsCreating(true)
        }}
      >
        <DialogContent className="top-[18dvh] w-140 max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden p-0">
          <DialogCloseButton
            type="button"
            onPointerDown={handleClosePointerDown}
            onClick={handleCloseClick}
          />
          {isCreating && (
            <form
              noValidate
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault()
                void handleCreateRelease(event.currentTarget)
              }}
            >
              <div className="border-b border-divider-subtle px-6 py-5 pr-14">
                <div className="min-w-0">
                  <DialogTitle className="title-xl-semi-bold text-text-primary">
                    {t('versions.createRelease')}
                  </DialogTitle>
                  <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
                    {t('versions.createReleaseDescription')}
                  </DialogDescription>
                </div>
              </div>

              <div className="flex flex-col gap-5 px-6 py-5">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label id="release-source-mode-label" className="system-xs-medium-uppercase text-text-tertiary">
                      {t('versions.releaseSourceLabel')}
                    </label>
                    <SegmentedControl<ReleaseSourceMode>
                      aria-labelledby="release-source-mode-label"
                      value={[releaseSourceMode]}
                      onValueChange={(value) => {
                        const nextMode = selectedReleaseSourceMode(value)
                        if (nextMode)
                          handleReleaseSourceModeChange(nextMode)
                      }}
                      className="shrink-0"
                    >
                      <SegmentedControlItem value="sourceApp" className="gap-1.5">
                        <span className="i-ri-apps-2-line size-4 shrink-0" aria-hidden="true" />
                        <span>{t('versions.sourceAppOption')}</span>
                      </SegmentedControlItem>
                      <SegmentedControlItem value="dsl" className="gap-1.5">
                        <span className="i-ri-upload-cloud-2-line size-4 shrink-0" aria-hidden="true" />
                        <span>{t('versions.manualDslOption')}</span>
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </div>

                  <div className="min-h-12">
                    {releaseSourceMode === 'sourceApp'
                      ? (
                          <div className="flex min-h-12 items-center">
                            <SourceAppPicker
                              value={selectedSourceApp}
                              onChange={(app) => {
                                setSourceApp(app)
                                clearCreateError()
                              }}
                              ariaLabel={t('versions.sourceAppOption')}
                            />
                          </div>
                        )
                      : (
                          <div className="flex min-h-12 flex-col gap-2">
                            <Uploader
                              file={dslFile}
                              updateFile={handleDslFileChange}
                              className="mt-0"
                            />
                            {isReadingDsl && (
                              <div className="system-xs-regular text-text-tertiary">
                                {t('versions.dslReading')}
                              </div>
                            )}
                            {dslReadError && (
                              <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
                                {t('versions.dslReadFailed')}
                              </div>
                            )}
                            {hasUnsupportedDslMode && (
                              <div role="alert" className="system-xs-regular text-util-colors-red-red-600">
                                {t('versions.dslUnsupportedMode')}
                              </div>
                            )}
                          </div>
                        )}
                  </div>
                </div>

                <UnsupportedDslNodesAlert nodes={unsupportedDslNodes} />

                {isCheckingReleaseContent && (
                  <div className="rounded-lg border border-divider-subtle bg-background-default-subtle px-3 py-2 system-sm-regular text-text-tertiary">
                    {t('versions.checkingReleaseContent')}
                  </div>
                )}

                {matchedRelease && (
                  <div role="alert" className="rounded-lg border border-util-colors-warning-warning-200 bg-util-colors-warning-warning-50 px-3 py-2 system-sm-regular text-util-colors-warning-warning-700">
                    {t('versions.releaseAlreadyExists', { name: releaseContentMatchLabel(matchedRelease) })}
                  </div>
                )}

                {releaseContentCheckFailed && (
                  <div role="alert" className="rounded-lg border border-util-colors-red-red-200 bg-util-colors-red-red-50 px-3 py-2 system-sm-regular text-util-colors-red-red-700">
                    {t('versions.releaseContentCheckFailed')}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-name">
                    {t('versions.releaseNameLabel')}
                  </label>
                  <Input
                    id="release-name"
                    name="releaseName"
                    placeholder={t('versions.releaseNamePlaceholder')}
                    maxLength={128}
                    autoComplete="off"
                    value={releaseName}
                    aria-invalid={releaseNameRequired || undefined}
                    aria-describedby={releaseNameRequired ? 'release-name-error' : undefined}
                    onBlur={() => setReleaseNameTouched(true)}
                    onChange={(event) => {
                      setReleaseName(event.target.value)
                      if (releaseNameTouched && event.target.value.trim())
                        setReleaseNameTouched(false)
                    }}
                    autoFocus
                    className="h-9"
                  />
                  {releaseNameRequired && (
                    <div id="release-name-error" role="alert" className="system-xs-regular text-text-destructive">
                      {t('versions.releaseNameRequired')}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-description">
                      {t('versions.releaseDescriptionLabel')}
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="system-xs-regular text-text-quaternary">
                        {t('versions.optional')}
                      </span>
                      <span
                        className={cn(
                          'system-xs-regular tabular-nums',
                          isNearLimit ? 'text-util-colors-warning-warning-700' : 'text-text-quaternary',
                        )}
                      >
                        {descriptionLength}
                        /
                        {DESCRIPTION_MAX_LENGTH}
                      </span>
                    </div>
                  </div>
                  <textarea
                    id="release-description"
                    name="releaseDescription"
                    placeholder={t('versions.releaseDescriptionPlaceholder')}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    autoComplete="off"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="min-h-24 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-4 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
                <div className="flex shrink-0 justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isCreatePending}
                    onPointerDown={handleClosePointerDown}
                    onClick={handleCloseClick}
                  >
                    {t('versions.cancelCreate')}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="min-w-22"
                    disabled={!canCreate}
                  >
                    {isCreatePending ? t('versions.creating') : isCheckingReleaseContent ? t('versions.checkingReleaseContent') : t('versions.create')}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
