'use client'

import type { CreateReleaseReply } from '@dify/contracts/enterprise/types.gen'
import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { SourceAppPickerValue } from '../../components/create-instance-modal'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { ToggleGroup, ToggleGroupItem } from '@langgenius/dify-ui/toggle-group'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from '@/app/components/app/create-from-dsl-modal/uploader'
import { consoleQuery } from '@/service/client'
import { SourceAppPicker } from '../../components/create-instance-modal'

type ReleaseSourceMode = 'sourceApp' | 'dsl'

const DESCRIPTION_MAX_LENGTH = 512
const DESCRIPTION_WARN_THRESHOLD = 460
const DEFAULT_RELEASE_SOURCE_MODE: ReleaseSourceMode = 'sourceApp'
const DEFAULT_SOURCE_RELEASE_PAGE_SIZE = 1

function encodeUtf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value)
  const chunkSize = 0x8000
  const chunks: string[] = []

  for (let offset = 0; offset < bytes.length; offset += chunkSize)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)))

  return btoa(chunks.join(''))
}

function selectedReleaseSourceMode(value: readonly ReleaseSourceMode[] | undefined) {
  return value?.[0]
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
  const [description, setDescription] = useState('')
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
  const defaultSourceAppQuery = useQuery(consoleQuery.apps.byAppId.get.queryOptions({
    input: isCreating && latestSourceAppId && !sourceApp
      ? {
          params: { app_id: latestSourceAppId },
        }
      : skipToken,
  }))
  const defaultSourceApp: SourceAppPickerValue | undefined = latestSourceAppId
    ? {
        id: latestSourceAppId,
        name: defaultSourceAppQuery.data?.name || latestSourceAppId,
      }
    : undefined
  const selectedSourceApp = sourceApp ?? defaultSourceApp
  const selectedSourceAppId = selectedSourceApp?.id

  const isCreatePending = createReleaseFromSourceApp.isPending || createReleaseFromDsl.isPending

  function resetDslState() {
    dslReadTokenRef.current += 1
    setDslFile(undefined)
    setDslContent('')
    setIsReadingDsl(false)
    setDslReadError(false)
  }

  function closeDialog() {
    setIsCreating(false)
    setReleaseSourceMode(DEFAULT_RELEASE_SOURCE_MODE)
    setSourceApp(undefined)
    resetDslState()
    setDescription('')
  }

  function handleReleaseSourceModeChange(nextMode: ReleaseSourceMode) {
    if (nextMode === releaseSourceMode)
      return

    setReleaseSourceMode(nextMode)
    if (nextMode === 'sourceApp')
      resetDslState()
    else
      setSourceApp(undefined)
  }

  function handleDslFileChange(file?: File) {
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

  function handleCreateRelease(form: HTMLFormElement) {
    if (isCreatePending)
      return

    const formData = new FormData(form)
    const releaseName = String(formData.get('name') ?? '').trim()
    const releaseDescription = description.trim()
    if (!releaseName)
      return

    const handleSuccess = (response: CreateReleaseReply) => {
      if (!response.release?.id) {
        toast.error(t('versions.createFailed'))
        return
      }
      const createdName = response.release.name ?? releaseName
      toast.success(t('versions.createSuccess', { name: createdName }))
      form.reset()
      closeDialog()
    }
    const handleError = () => {
      toast.error(t('versions.createFailed'))
    }

    if (releaseSourceMode === 'dsl') {
      if (!dslContent.trim() || isReadingDsl || dslReadError)
        return

      createReleaseFromDsl.mutate({
        body: {
          appInstanceId,
          dsl: encodeUtf8Base64(dslContent),
          name: releaseName,
          description: releaseDescription || undefined,
          createAppInstance: false,
        },
      }, {
        onSuccess: handleSuccess,
        onError: handleError,
      })
      return
    }

    if (!selectedSourceAppId)
      return

    createReleaseFromSourceApp.mutate({
      body: {
        appInstanceId,
        sourceAppId: selectedSourceAppId,
        name: releaseName,
        description: releaseDescription || undefined,
        createAppInstance: false,
      },
    }, {
      onSuccess: handleSuccess,
      onError: handleError,
    })
  }

  const descriptionLength = description.length
  const isNearLimit = descriptionLength >= DESCRIPTION_WARN_THRESHOLD
  const hasDslContent = Boolean(dslContent.trim())
  const canCreateFromSourceApp = releaseSourceMode === 'sourceApp' && Boolean(selectedSourceAppId)
  const canCreateFromDsl = releaseSourceMode === 'dsl' && hasDslContent && !isReadingDsl && !dslReadError
  const canCreate = Boolean(!isCreatePending && (canCreateFromSourceApp || canCreateFromDsl))

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
        <DialogContent className="w-140 max-w-[calc(100vw-32px)] overflow-hidden p-0">
          <DialogCloseButton />
          {isCreating && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                handleCreateRelease(event.currentTarget)
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
                    <ToggleGroup<ReleaseSourceMode>
                      aria-labelledby="release-source-mode-label"
                      value={[releaseSourceMode]}
                      onValueChange={(value) => {
                        const nextMode = selectedReleaseSourceMode(value)
                        if (nextMode)
                          handleReleaseSourceModeChange(nextMode)
                      }}
                      className="shrink-0"
                    >
                      <ToggleGroupItem value="sourceApp" className="gap-1.5">
                        <span className="i-ri-apps-2-line size-4 shrink-0" aria-hidden="true" />
                        <span>{t('versions.sourceAppOption')}</span>
                      </ToggleGroupItem>
                      <ToggleGroupItem value="dsl" className="gap-1.5">
                        <span className="i-ri-upload-cloud-2-line size-4 shrink-0" aria-hidden="true" />
                        <span>{t('versions.manualDslOption')}</span>
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>

                  <div className="min-h-12">
                    {releaseSourceMode === 'sourceApp'
                      ? (
                          <div className="flex min-h-12 items-center">
                            <SourceAppPicker
                              value={selectedSourceApp}
                              onChange={setSourceApp}
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
                          </div>
                        )}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-name">
                    {t('versions.releaseNameLabel')}
                  </label>
                  <Input
                    id="release-name"
                    name="name"
                    placeholder={t('versions.releaseNamePlaceholder')}
                    maxLength={128}
                    required
                    autoFocus
                    className="h-9"
                  />
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
                    name="description"
                    placeholder={t('versions.releaseDescriptionPlaceholder')}
                    maxLength={DESCRIPTION_MAX_LENGTH}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="min-h-24 w-full resize-none appearance-none rounded-md border border-transparent bg-components-input-bg-normal p-2 px-3 system-sm-regular text-components-input-text-filled caret-primary-600 outline-hidden placeholder:text-components-input-text-placeholder hover:border-components-input-border-hover hover:bg-components-input-bg-hover focus:border-components-input-border-active focus:bg-components-input-bg-active focus:shadow-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
                <div className="system-xs-regular text-text-tertiary">
                  {t('versions.createReleaseHint')}
                </div>
                <div className="flex shrink-0 justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isCreatePending}
                    onClick={closeDialog}
                  >
                    {t('versions.cancelCreate')}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="min-w-22"
                    disabled={!canCreate}
                  >
                    {isCreatePending ? t('versions.creating') : t('versions.create')}
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
