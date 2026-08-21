'use client'

import type {
  KnowledgeFsSpaceCreatePayload,
  KnowledgeFsSpaceCreateResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { CreateKnowledgeExitReason } from './components/create-knowledge-exit-dialog'
import type { KnowledgeVisibility } from './create-knowledge-workflow'
import type { QueuedUpload } from './create-upload-queue'
import type { KnowledgeFsUploadPhase, KnowledgeFsUploadProgress } from './knowledge-fs-upload'
import type { NewKnowledgeSourceDraft, NewKnowledgeStartMode } from './routes'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { RadioGroup } from '@langgenius/dify-ui/radio'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { datasetDefaultPermissionKeysAtom } from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom, rbacEnabledAtom } from '@/features/system-features/state'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeIllustration, StartMode } from './components/create-knowledge-dialog-parts'
import { CreateKnowledgeExitDialog } from './components/create-knowledge-exit-dialog'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import {
  createKnowledge,
  DESCRIPTION_MAX_LENGTH,
  isDefinitiveCreationRejection,
  KnowledgeCreationError,
  NAME_MAX_LENGTH,
  waitForKnowledgeSpaceReady,
} from './create-knowledge-workflow'
import { CreateSourceSetup } from './create-source-setup'
import { CreateUploadQueue } from './create-upload-queue'
import {
  discardKnowledgeFsStagedUpload,
  stageKnowledgeFsDocument,
  uploadKnowledgeFsDocuments,
} from './knowledge-fs-upload'
import { createRequestId } from './request-id'
import {
  createNewKnowledgeSourceDraft,
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeListPath,
  newKnowledgeSettingsPath,
} from './routes'

type InitialSource = NonNullable<KnowledgeFsSpaceCreatePayload['initial_source']>

function normalizeStartMode(value: string | null): NewKnowledgeStartMode {
  if (value === 'source' || value === 'upload') return value
  return 'empty'
}

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tDatasetCreation } = useTranslation('datasetCreation')
  const { t: tWorkflow } = useTranslation('workflow')
  useDocumentTitle(t(($) => $['newKnowledge.createTitle']))
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const dialogTitleId = useId()
  const permissionDescriptionId = useId()
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const isRbacEnabled = useAtomValue(rbacEnabledAtom)
  const canConfigureAccess =
    !isRbacEnabled || hasPermission(datasetDefaultPermissionKeys, DatasetACLPermission.AccessConfig)
  const defaultVisibility: KnowledgeVisibility =
    isRbacEnabled && canConfigureAccess ? 'all_team_members' : 'only_me'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(defaultVisibility)
  const requestedStartMode = normalizeStartMode(searchParams.get('start'))
  const initialStartMode =
    requestedStartMode === 'upload' && !uploadAvailable ? 'empty' : requestedStartMode
  const [startMode, setStartMode] = useState<NewKnowledgeStartMode>(initialStartMode)
  const [sourceDraft, setSourceDraft] = useState<NewKnowledgeSourceDraft>(() =>
    createNewKnowledgeSourceDraft('websiteCrawl'),
  )
  const [initialSource, setInitialSource] = useState<InitialSource>()
  const initialSourceRef = useRef<InitialSource | undefined>(undefined)
  const [uploads, setUploads] = useState<QueuedUpload[]>([])
  const [createdKnowledge, setCreatedKnowledge] = useState<KnowledgeFsSpaceCreateResponse>()
  const [modelSetupDialogOpen, setModelSetupDialogOpen] = useState(false)
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const [stagingCount, setStagingCount] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadPhases, setUploadPhases] = useState<ReadonlyMap<File, KnowledgeFsUploadPhase>>(
    () => new Map(),
  )
  const [uploadError, setUploadError] = useState(false)
  const [exitReason, setExitReason] = useState<CreateKnowledgeExitReason | null>(null)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const uploadsRef = useRef<QueuedUpload[]>([])
  const uploadProgressRef = useRef<KnowledgeFsUploadProgress>(new Map())
  const historyGuardArmedRef = useRef(false)
  const browserBackExitRef = useRef(false)
  const pendingNavigationRef = useRef<string | undefined>(undefined)
  const navigationFallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })
  const submissionPending = createMutation.isPending || uploading || stagingCount > 0
  const validUploads = uploads.filter(({ issue }) => !issue)
  const createErrorMessage = t(($) => $['newKnowledge.createFailed'])
  const normalizedName = name.trim()
  const normalizedDescription = description.trim()
  const nameLengthInvalid = Array.from(normalizedName).length > NAME_MAX_LENGTH
  const descriptionLengthInvalid = Array.from(normalizedDescription).length > DESCRIPTION_MAX_LENGTH
  const uploadSubmissionBlocked =
    startMode === 'upload' &&
    (!uploadAvailable ||
      !validUploads.length ||
      validUploads.some((upload) => upload.stagingFailed || !upload.stagedUploadId))
  const sourceSubmissionBlocked = startMode === 'source' && !initialSource
  const sourceDraftChanged =
    JSON.stringify(sourceDraft) !==
    JSON.stringify(createNewKnowledgeSourceDraft(sourceDraft.sourceType))
  const hasUnsavedChanges = Boolean(
    name ||
    description ||
    visibility !== defaultVisibility ||
    startMode !== initialStartMode ||
    sourceDraftChanged ||
    uploads.length ||
    createdKnowledge,
  )

  const updateInitialSource = useCallback((source?: InitialSource) => {
    initialSourceRef.current = source
    setInitialSource(source)
  }, [])

  const armHistoryGuard = useCallback(() => {
    globalThis.history.pushState(globalThis.history.state, '', globalThis.location.href)
    historyGuardArmedRef.current = true
  }, [])

  const replaceAfterHistoryGuard = useCallback(
    (path: string) => {
      if (!historyGuardArmedRef.current) {
        router.replace(path)
        return
      }

      pendingNavigationRef.current = path
      globalThis.history.back()
      globalThis.clearTimeout(navigationFallbackRef.current)
      navigationFallbackRef.current = globalThis.setTimeout(() => {
        if (pendingNavigationRef.current !== path) return
        pendingNavigationRef.current = undefined
        historyGuardArmedRef.current = false
        router.replace(path)
      }, 1000)
    },
    [router],
  )

  useEffect(() => {
    if (
      !hasUnsavedChanges ||
      historyGuardArmedRef.current ||
      browserBackExitRef.current ||
      pendingNavigationRef.current
    )
      return

    armHistoryGuard()
  }, [armHistoryGuard, hasUnsavedChanges])

  useEffect(() => {
    const handlePopState = () => {
      if (!historyGuardArmedRef.current) return

      historyGuardArmedRef.current = false
      const pendingNavigation = pendingNavigationRef.current
      if (pendingNavigation) {
        globalThis.clearTimeout(navigationFallbackRef.current)
        navigationFallbackRef.current = undefined
        pendingNavigationRef.current = undefined
        router.replace(pendingNavigation)
        return
      }
      if (!hasUnsavedChanges) {
        router.replace(newKnowledgeListPath)
        return
      }

      browserBackExitRef.current = true
      setExitReason(createdKnowledge ? 'partial' : 'discard')
    }

    globalThis.addEventListener('popstate', handlePopState)
    return () => globalThis.removeEventListener('popstate', handlePopState)
  }, [createdKnowledge, hasUnsavedChanges, router])

  useEffect(
    () => () => {
      globalThis.clearTimeout(navigationFallbackRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!hasUnsavedChanges) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    globalThis.addEventListener('beforeunload', handleBeforeUnload)
    return () => globalThis.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  const resetUnsubmittedError = () => {
    if (!submissionLocked) createMutation.reset()
    setUploadError(false)
  }

  const updateUploads = (update: (current: QueuedUpload[]) => QueuedUpload[]) => {
    const next = update(uploadsRef.current)
    uploadsRef.current = next
    setUploads(next)
  }

  const handleUploadsChange = (nextUploads: QueuedUpload[]) => {
    const previousUploads = uploadsRef.current
    const nextIds = new Set(nextUploads.map(({ id }) => id))
    const previousIds = new Set(previousUploads.map(({ id }) => id))
    const removedUploads = previousUploads.filter(({ id }) => !nextIds.has(id))
    const addedUploads = nextUploads.filter(({ id }) => !previousIds.has(id))
    uploadsRef.current = nextUploads
    setUploads(nextUploads)
    resetUnsubmittedError()

    for (const removed of removedUploads) {
      if (removed.stagedUploadId)
        void discardKnowledgeFsStagedUpload(removed.stagedUploadId).catch(() => undefined)
    }

    for (const added of addedUploads) {
      if (added.issue) continue
      setStagingCount((count) => count + 1)
      setUploadPhases((current) => new Map(current).set(added.file, 'pending'))
      void stageKnowledgeFsDocument(added.file)
        .then((stagedUploadId) => {
          const stillQueued = uploadsRef.current.some(({ id }) => id === added.id)
          if (!stillQueued) {
            void discardKnowledgeFsStagedUpload(stagedUploadId).catch(() => undefined)
            return
          }
          updateUploads((current) =>
            current.map((upload) =>
              upload.id === added.id ? { ...upload, stagedUploadId, stagingFailed: false } : upload,
            ),
          )
          setUploadPhases((current) => new Map(current).set(added.file, 'completed'))
        })
        .catch(() => {
          updateUploads((current) =>
            current.map((upload) =>
              upload.id === added.id ? { ...upload, stagingFailed: true } : upload,
            ),
          )
          setUploadPhases((current) => {
            const next = new Map(current)
            next.delete(added.file)
            return next
          })
          setUploadError(true)
        })
        .finally(() => setStagingCount((count) => Math.max(0, count - 1)))
    }
  }

  const requestClose = () => {
    if (submissionPending) return
    if (createdKnowledge) {
      setExitReason('partial')
      return
    }
    if (hasUnsavedChanges) {
      setExitReason('discard')
      return
    }
    replaceAfterHistoryGuard(newKnowledgeListPath)
  }

  const confirmExit = () => {
    const confirmedReason = exitReason
    setExitReason(null)
    for (const upload of uploadsRef.current) {
      if (upload.stagedUploadId)
        void discardKnowledgeFsStagedUpload(upload.stagedUploadId).catch(() => undefined)
    }
    if (confirmedReason === 'partial' && createdKnowledge) {
      browserBackExitRef.current = false
      replaceAfterHistoryGuard(newKnowledgeDetailPath(createdKnowledge.control_space_id))
      return
    }
    browserBackExitRef.current = false
    replaceAfterHistoryGuard(newKnowledgeListPath)
  }

  const cancelExit = () => {
    setExitReason(null)
    if (!browserBackExitRef.current) return

    browserBackExitRef.current = false
    armHistoryGuard()
  }

  const handleSubmit = async () => {
    if (submissionPending || uploadSubmissionBlocked || sourceSubmissionBlocked) return

    if (!normalizedName || nameLengthInvalid || descriptionLengthInvalid) return

    const latestInitialSource = initialSourceRef.current ?? initialSource
    if (startMode === 'source' && !latestInitialSource) return

    idempotencyKeyRef.current ??= createRequestId()
    setSubmissionLocked(true)
    try {
      const result = await createMutation.mutateAsync({
        existingKnowledge: createdKnowledge,
        description: normalizedDescription,
        idempotencyKey: idempotencyKeyRef.current,
        initialSource: startMode === 'source' ? latestInitialSource : undefined,
        name: normalizedName,
        onCreated: (knowledgeSpace) => {
          setCreatedKnowledge(knowledgeSpace)
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.get.key(),
          })
        },
        visibility,
      })
      const created = result.knowledgeSpace
      if (startMode === 'upload') {
        if (result.modelSetupRequired) {
          setModelSetupDialogOpen(true)
          return
        }
        setUploading(true)
        setUploadError(false)
        try {
          await waitForKnowledgeSpaceReady(created.control_space_id)
          await uploadKnowledgeFsDocuments(
            created.control_space_id,
            validUploads.map(({ file, id, stagedUploadId }) => ({
              file,
              id,
              uploadId: stagedUploadId!,
            })),
            uploadProgressRef.current,
            (file, phase) => {
              setUploadPhases((current) => {
                const next = new Map(current)
                next.set(file, phase)
                return next
              })
            },
          )
        } catch {
          setUploadError(true)
          return
        } finally {
          setUploading(false)
        }
      }

      replaceAfterHistoryGuard(
        startMode === 'upload'
          ? newKnowledgeDocumentsPath(created.control_space_id)
          : `${newKnowledgeDetailPath(created.control_space_id)}${
              startMode === 'source'
                ? `?awaitInitialSource=${encodeURIComponent(created.operation_id)}`
                : ''
            }`,
      )
    } catch (error) {
      if (
        error instanceof KnowledgeCreationError &&
        (error.stage === 'preflight' || isDefinitiveCreationRejection(error.originalError))
      ) {
        idempotencyKeyRef.current = undefined
        setSubmissionLocked(false)
      }
      // The mutation state renders a retryable, localized error without exposing upstream details.
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="bg-background-overlay-backdrop backdrop-blur-[6px]" />
        <DialogPopup
          aria-labelledby={dialogTitleId}
          className="fixed inset-x-3 top-4 bottom-4 grid min-h-0 min-w-0 overflow-hidden xl:grid-cols-2"
        >
          <Button
            variant="ghost"
            size="large"
            aria-label={tCommon(($) => $['operation.close'])}
            className="absolute top-3 right-3 z-10 size-9 rounded-xl bg-background-section-burn px-0 text-text-tertiary"
            onClick={requestClose}
            disabled={submissionPending}
          >
            <span aria-hidden className="i-ri-close-line size-5" />
          </Button>

          <div className="flex min-h-0 min-w-0 flex-col items-center border-divider-subtle xl:items-end xl:border-r">
            <div className="min-h-6 w-full max-w-180 flex-1 [@media(max-height:850px)]:h-6 [@media(max-height:850px)]:flex-none" />
            <Form
              className="flex max-h-full min-h-0 w-full max-w-180 flex-col"
              onFormSubmit={() => void handleSubmit()}
            >
              <header className="shrink-0 px-6 pt-2 pb-6 sm:px-10">
                <DialogTitle id={dialogTitleId} className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['newKnowledge.createTitle'])}
                </DialogTitle>
              </header>

              <div className="flex min-h-0 scrollbar-none flex-col gap-7 overflow-y-auto px-6 pb-7 sm:px-10">
                <div className="flex flex-col gap-4">
                  <Field
                    name="name"
                    className="gap-1.5"
                    invalid={nameLengthInvalid}
                    validate={(value) => {
                      if (typeof value === 'string' && value.length > 0 && !value.trim())
                        return t(($) => $['newKnowledge.nameRequired'])

                      return null
                    }}
                  >
                    <FieldLabel>
                      {t(($) => $['newKnowledge.name'])}
                      <span aria-hidden className="ml-0.5 text-text-destructive">
                        *
                      </span>
                    </FieldLabel>
                    <Input
                      autoComplete="off"
                      aria-describedby={
                        nameLengthInvalid ? 'knowledge-create-name-error' : undefined
                      }
                      disabled={submissionLocked}
                      placeholder={t(($) => $['newKnowledge.namePlaceholder'])}
                      required
                      value={name}
                      onValueChange={(value) => {
                        setName(value)
                        resetUnsubmittedError()
                      }}
                    />
                    <FieldError match="valueMissing">
                      {t(($) => $['newKnowledge.nameRequired'])}
                    </FieldError>
                    <FieldError id="knowledge-create-name-error" match={nameLengthInvalid}>
                      {tDatasetCreation(($) => $['stepOne.modal.nameLengthInvalid'])}
                    </FieldError>
                    <FieldError match="customError" />
                  </Field>
                  <Field name="description" className="gap-1.5" invalid={descriptionLengthInvalid}>
                    <FieldLabel>{t(($) => $['newKnowledge.description'])}</FieldLabel>
                    <Textarea
                      autoComplete="off"
                      aria-describedby={
                        descriptionLengthInvalid ? 'knowledge-create-description-error' : undefined
                      }
                      className="min-h-20"
                      disabled={submissionLocked}
                      name="description"
                      placeholder={t(($) => $['newKnowledge.descriptionPlaceholder'])}
                      value={description}
                      onValueChange={(value) => {
                        setDescription(value)
                        resetUnsubmittedError()
                      }}
                    />
                    <FieldDescription>
                      {t(($) => $['newKnowledge.descriptionHelp'])}
                    </FieldDescription>
                    <FieldError
                      id="knowledge-create-description-error"
                      match={descriptionLengthInvalid}
                    >
                      {tWorkflow(($) => $['chatVariable.modal.descriptionTooLong'], {
                        maxLength: DESCRIPTION_MAX_LENGTH,
                      })}
                    </FieldError>
                  </Field>
                  <div className="flex flex-col gap-1.5">
                    <Select
                      name="permission"
                      value={visibility}
                      disabled={submissionLocked || !canConfigureAccess}
                      onValueChange={(value) => {
                        if (value) setVisibility(value)
                      }}
                    >
                      <SelectLabel>{t(($) => $['newKnowledge.permission'])}</SelectLabel>
                      <SelectTrigger
                        aria-describedby={!canConfigureAccess ? permissionDescriptionId : undefined}
                      >
                        {t(($) =>
                          visibility === 'all_team_members'
                            ? $['newKnowledge.permissionAllMembers']
                            : $['newKnowledge.permissionOnlyMe'],
                        )}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="only_me">
                          <SelectItemText>
                            {t(($) => $['newKnowledge.permissionOnlyMe'])}
                          </SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                        <SelectItem value="all_team_members">
                          <SelectItemText>
                            {t(($) => $['newKnowledge.permissionAllMembers'])}
                          </SelectItemText>
                          <SelectItemIndicator />
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {!canConfigureAccess && (
                      <p
                        id={permissionDescriptionId}
                        className="py-0.5 body-xs-regular text-text-tertiary"
                      >
                        {t(($) => $['newKnowledge.permissionRestricted'])}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <Fieldset>
                    <FieldsetLegend className="py-0 system-md-semibold">
                      {t(($) => $['newKnowledge.startWith'])}
                    </FieldsetLegend>
                    <p className="pb-1.5 body-xs-regular text-text-tertiary">
                      {t(($) => $['newKnowledge.startWithHelp'])}
                    </p>
                    <RadioGroup<NewKnowledgeStartMode>
                      value={startMode}
                      aria-label={t(($) => $['newKnowledge.startWith'])}
                      className="mt-2 flex-col items-stretch gap-2"
                      disabled={submissionLocked}
                      onValueChange={(value) => {
                        setStartMode(value)
                        resetUnsubmittedError()
                      }}
                    >
                      <StartMode
                        value="empty"
                        icon="i-ri-folder-6-line"
                        selected={startMode === 'empty'}
                        title={t(($) => $['newKnowledge.startEmpty'])}
                        description={t(($) => $['newKnowledge.startEmptyDescription'])}
                      />
                      <StartMode
                        value="source"
                        icon="i-custom-public-new-rag-connect-source"
                        selected={startMode === 'source'}
                        title={t(($) => $['newKnowledge.connectSource'])}
                        description={t(($) => $['newKnowledge.connectSourceDescription'])}
                        endAdornment={
                          startMode === 'upload' ? (
                            <span
                              aria-hidden
                              className="h-4 w-20.5 shrink-0 bg-[url('/images/new-rag/create-knowledge-connectors.svg')] bg-contain bg-center bg-no-repeat"
                            />
                          ) : undefined
                        }
                      >
                        <CreateSourceSetup
                          disabled={submissionLocked}
                          draft={sourceDraft}
                          onDraftChange={(value) => {
                            setSourceDraft(value)
                            resetUnsubmittedError()
                          }}
                          onInitialSourceChange={updateInitialSource}
                          onSourceTypeChange={(value) => {
                            setSourceDraft(createNewKnowledgeSourceDraft(value))
                            updateInitialSource(undefined)
                            resetUnsubmittedError()
                          }}
                        />
                      </StartMode>
                      <StartMode
                        value="upload"
                        icon="i-ri-file-text-line"
                        selected={startMode === 'upload'}
                        disabled={!uploadAvailable}
                        title={t(($) => $['newKnowledge.uploadFiles'])}
                        description={t(($) => $['newKnowledge.uploadFilesDescription'])}
                      >
                        <CreateUploadQueue
                          disabled={submissionPending}
                          uploads={uploads}
                          uploadPhases={uploadPhases}
                          uploading={uploading || stagingCount > 0}
                          onChange={handleUploadsChange}
                        />
                      </StartMode>
                    </RadioGroup>
                  </Fieldset>

                  {createMutation.isError && (
                    <div
                      className="rounded-lg bg-state-destructive-hover px-3 py-2 system-sm-regular text-text-destructive"
                      role="alert"
                    >
                      {createErrorMessage}
                    </div>
                  )}
                  {uploadError && (
                    <div
                      className="rounded-lg bg-state-destructive-hover px-3 py-2 system-sm-regular text-text-destructive"
                      role="alert"
                    >
                      {t(($) => $['newKnowledge.documentUploadFailed'])}
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-divider-subtle px-6 pt-7 pb-12 sm:px-10">
                <div className="flex justify-end gap-2">
                  <Button type="button" disabled={submissionPending} onClick={requestClose}>
                    {tCommon(($) => $['operation.cancel'])}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={submissionPending}
                    disabled={
                      submissionPending || uploadSubmissionBlocked || sourceSubmissionBlocked
                    }
                  >
                    {t(($) => $['newKnowledge.createTitle'])}
                  </Button>
                </div>
              </div>
            </Form>
            <div className="min-h-px w-full max-w-180 flex-1 [@media(max-height:850px)]:h-6 [@media(max-height:850px)]:flex-none" />
          </div>

          <aside className="hidden min-h-0 min-w-0 xl:block">
            <KnowledgeIllustration title={t(($) => $['newKnowledge.illustrationHeadline'])} />
          </aside>
        </DialogPopup>
      </DialogPortal>
      <CreateKnowledgeExitDialog
        reason={exitReason}
        onCancel={cancelExit}
        onConfirm={confirmExit}
      />
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={() => {
          setModelSetupDialogOpen(false)
          if (createdKnowledge)
            replaceAfterHistoryGuard(newKnowledgeSettingsPath(createdKnowledge.control_space_id))
        }}
      />
    </Dialog>
  )
}
