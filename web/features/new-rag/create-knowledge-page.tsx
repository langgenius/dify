'use client'

import type { KnowledgeFsSpaceCreateResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { CreateKnowledgeExitReason } from './components/create-knowledge-exit-dialog'
import type { KnowledgeVisibility } from './create-knowledge-workflow'
import type { WebsiteCrawlPreviewSelection } from './create-source-setup'
import type { QueuedUpload } from './create-upload-queue'
import type { KnowledgeFsUploadProgress } from './knowledge-fs-upload'
import type { NewKnowledgeSourceDraft, NewKnowledgeStartMode } from './routes'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
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
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { datasetDefaultPermissionKeysAtom } from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom, rbacEnabledAtom } from '@/features/system-features/state'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
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
} from './create-knowledge-workflow'
import { CreateSourceSetup } from './create-source-setup'
import { CreateUploadQueue } from './create-upload-queue'
import { uploadKnowledgeFsDocuments } from './knowledge-fs-upload'
import { createRequestId } from './request-id'
import {
  createNewKnowledgeSourceDraft,
  isValidWebsiteSourceDraft,
  newKnowledgeAddSourcePath,
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeListPath,
  newKnowledgeSettingsPath,
  newKnowledgeSourceDraftStorageKey,
} from './routes'
import {
  crawlPreviewPageListFromApi,
  sourceConnectionListFromApi,
  sourceFromApi,
  sourceProviderListFromApi,
  sourceSyncPolicyFromApi,
  sourceWorkflowFromApi,
} from './source-models'

const FIRECRAWL_PROVIDER_ID = 'plugin-daemon-website'
const CONNECTION_PAGE_SIZE = 200
const PAGE_SIZE = 200
const MAX_CURSOR_PAGES = 100
const IMPORT_POLL_INTERVAL_MS = 1000
const IMPORT_POLL_ATTEMPTS = 120
const SUCCESS_STATES = new Set(['complete', 'completed', 'preview_ready', 'success', 'succeeded'])
const IMPORT_SUCCESS_STATES = new Set(['complete', 'completed', 'success', 'succeeded'])
const TERMINAL_STATES = new Set([
  ...IMPORT_SUCCESS_STATES,
  'canceled',
  'cancelled',
  'error',
  'exhausted',
  'failed',
  'superseded',
  'timed_out',
  'timeout',
  'zero_results',
])

function normalizedState(state: string) {
  return state.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function requestStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (!error || typeof error !== 'object') return undefined
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('data' in error && error.data && typeof error.data === 'object' && 'status' in error.data)
    return typeof error.data.status === 'number' ? error.data.status : undefined
}

async function waitForWorkflowTerminal(knowledgeSpaceId: string, runId: string) {
  for (let attempt = 0; attempt < IMPORT_POLL_ATTEMPTS; attempt += 1) {
    const run = sourceWorkflowFromApi(
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.get({
        params: { control_space_id: knowledgeSpaceId, run_id: runId },
      }),
    )
    if (
      TERMINAL_STATES.has(normalizedState(run.state)) ||
      SUCCESS_STATES.has(normalizedState(run.state))
    )
      return run
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS))
  }
  throw new Error('Source workflow did not reach a terminal state')
}

async function listWorkflowPages(knowledgeSpaceId: string, runId: string) {
  const pages = new Map<string, ReturnType<typeof crawlPreviewPageListFromApi>['items'][number]>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pageCount = 0
  do {
    pageCount += 1
    if (pageCount > MAX_CURSOR_PAGES) throw new Error('Workflow page cursor limit exceeded')
    const response = crawlPreviewPageListFromApi(
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.pages.get({
        params: { control_space_id: knowledgeSpaceId, run_id: runId },
        query: { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE },
      }),
    )
    for (const page of response.items) pages.set(page.pageId, page)
    const nextCursor = response.nextCursor
    if (!nextCursor || seenCursors.has(nextCursor)) break
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)
  return [...pages.values()]
}

async function findFirecrawlConnection(knowledgeSpaceId: string) {
  const providers = sourceProviderListFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceProviders.get({
      params: { control_space_id: knowledgeSpaceId },
    }),
  )
  const provider = providers.find((candidate) => candidate.id === FIRECRAWL_PROVIDER_ID)
  if (!provider) throw new Error('Firecrawl provider is unavailable')

  const connections = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()
  do {
    const response = sourceConnectionListFromApi(
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceConnections.get({
        params: { control_space_id: knowledgeSpaceId },
        query: { limit: CONNECTION_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      }),
    )
    connections.push(...response.items)
    const nextCursor = response.nextCursor
    if (!nextCursor || seenCursors.has(nextCursor)) break
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)

  const connection = connections.find(
    (candidate) => candidate.providerId === provider.id && candidate.status === 'active',
  )
  if (!connection) throw new Error('Firecrawl connection is unavailable')
  return { connection, provider }
}

async function importSelectedWebsitePages(
  knowledgeSpaceId: string,
  selection: WebsiteCrawlPreviewSelection,
) {
  const { connection, provider } = await findFirecrawlConnection(knowledgeSpaceId)
  const source = sourceFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.post({
      body: {
        connectionId: connection.id,
        metadata: {
          clientRequestId: createRequestId(),
          crawlOptions: {
            includeSubpages: selection.draft.includeSubpages,
            limit: selection.draft.maxPages,
          },
          preview: true,
          providerId: provider.id,
        },
        name: selection.draft.sourceName.trim(),
        status: 'disabled',
        type: 'web',
        uri: selection.draft.rootUrl,
      },
      params: { control_space_id: knowledgeSpaceId },
    }),
  )
  if (!source.version) throw new Error('Source has no version')
  const previewRun = sourceWorkflowFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.crawlPreview.post({
      headers: { 'Idempotency-Key': createRequestId() },
      params: { control_space_id: knowledgeSpaceId, source_id: source.id },
    }),
  )
  const terminalPreviewRun = await waitForWorkflowTerminal(knowledgeSpaceId, previewRun.id)
  if (!SUCCESS_STATES.has(normalizedState(terminalPreviewRun.state)))
    throw new Error('Source crawl preview failed')
  const kfsPages = await listWorkflowPages(knowledgeSpaceId, previewRun.id)
  const selectedUrls = new Set(
    selection.pages
      .filter((page) => selection.selectedPageIds.includes(page.pageId))
      .map((page) => page.sourceUrl),
  )
  const pageIds = kfsPages
    .filter((page) => selectedUrls.has(page.sourceUrl))
    .map((page) => page.pageId)
  if (!pageIds.length) throw new Error('Selected preview pages were not found in KnowledgeFS')

  const finalSource = sourceFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
      body: {
        expectedVersion: source.version,
        metadata: {
          clientRequestId: createRequestId(),
          crawlOptions: {
            includeSubpages: selection.draft.includeSubpages,
            limit: selection.draft.maxPages,
          },
          preview: false,
          providerId: provider.id,
        },
        name: selection.draft.sourceName.trim(),
        status: 'active',
      },
      params: { control_space_id: knowledgeSpaceId, source_id: source.id },
    }),
  )
  const importRun = sourceWorkflowFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.selection.post({
      body: { pageIds },
      headers: { 'Idempotency-Key': createRequestId() },
      params: { control_space_id: knowledgeSpaceId, run_id: previewRun.id },
    }),
  )
  const terminalImportRun = await waitForWorkflowTerminal(knowledgeSpaceId, importRun.id)
  if (!IMPORT_SUCCESS_STATES.has(normalizedState(terminalImportRun.state)))
    throw new Error('Source import failed')
  const importedSource = sourceFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.get({
      params: { control_space_id: knowledgeSpaceId, source_id: source.id },
    }),
  )
  if (!importedSource.version) throw new Error('Imported source has no version')
  const mode =
    selection.draft.syncPolicy === 'manual'
      ? ({ enabled: false, mode: 'manual' } as const)
      : selection.draft.syncPolicy === 'daily'
        ? ({ enabled: true, mode: 'interval' } as const)
        : ({ enabled: true, mode: 'provider' } as const)
  let expectedRevision = 0
  try {
    expectedRevision = sourceSyncPolicyFromApi(
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.syncPolicy.get({
        params: { control_space_id: knowledgeSpaceId, source_id: finalSource.id },
      }),
    ).revision
  } catch (error) {
    if (requestStatus(error) !== 404) throw error
  }
  await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.syncPolicy.put({
    body: {
      ...mode,
      expectedRevision,
      expectedSourceVersion: importedSource.version,
    },
    params: { control_space_id: knowledgeSpaceId, source_id: source.id },
  })
}

function normalizeStartMode(value: string | null): NewKnowledgeStartMode {
  if (value === 'source' || value === 'upload') return value
  return 'empty'
}

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
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
  const [websitePreviewSelection, setWebsitePreviewSelection] =
    useState<WebsiteCrawlPreviewSelection>()
  const websitePreviewSelectionRef = useRef<WebsiteCrawlPreviewSelection | undefined>(undefined)
  const sourceDraftsRef = useRef<
    Partial<Record<NewKnowledgeSourceDraft['sourceType'], NewKnowledgeSourceDraft>>
  >({})
  const [uploads, setUploads] = useState<QueuedUpload[]>([])
  const [createdKnowledge, setCreatedKnowledge] = useState<KnowledgeFsSpaceCreateResponse>()
  const [modelSetupDialogOpen, setModelSetupDialogOpen] = useState(false)
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const [exitReason, setExitReason] = useState<CreateKnowledgeExitReason | null>(null)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const uploadProgressRef = useRef<KnowledgeFsUploadProgress>(new Map())
  const historyGuardArmedRef = useRef(false)
  const browserBackExitRef = useRef(false)
  const pendingNavigationRef = useRef<string | undefined>(undefined)
  const navigationFallbackRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })
  const submissionPending = createMutation.isPending || uploading
  const createErrorMessage = t(($) => $['newKnowledge.createFailed'])
  const uploadSubmissionBlocked =
    startMode === 'upload' &&
    (!uploadAvailable || !uploads.length || uploads.some((upload) => upload.issue))
  const sourceSubmissionBlocked =
    startMode === 'source' &&
    (sourceDraft.sourceType === 'websiteCrawl'
      ? !isValidWebsiteSourceDraft(sourceDraft)
      : !sourceDraft.sourceName.trim())
  const sourceDraftChanged = Object.values({
    ...sourceDraftsRef.current,
    [sourceDraft.sourceType]: sourceDraft,
  }).some(
    (draft) =>
      JSON.stringify(draft) !== JSON.stringify(createNewKnowledgeSourceDraft(draft.sourceType)),
  )
  const hasUnsavedChanges = Boolean(
    name ||
    description ||
    visibility !== defaultVisibility ||
    startMode !== initialStartMode ||
    sourceDraftChanged ||
    uploads.length ||
    createdKnowledge,
  )

  const updateWebsitePreviewSelection = useCallback((selection?: WebsiteCrawlPreviewSelection) => {
    websitePreviewSelectionRef.current = selection
    setWebsitePreviewSelection(selection)
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

    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    if (!normalizedName) return

    idempotencyKeyRef.current ??= createRequestId()
    setSubmissionLocked(true)
    try {
      const result = await createMutation.mutateAsync({
        existingKnowledge: createdKnowledge,
        description: normalizedDescription,
        idempotencyKey: idempotencyKeyRef.current,
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
          await uploadKnowledgeFsDocuments(
            created.control_space_id,
            uploads.map(({ file, id }) => ({ file, id })),
            uploadProgressRef.current,
          )
        } catch {
          setUploadError(true)
          return
        } finally {
          setUploading(false)
        }
      }

      if (startMode === 'source') {
        const latestWebsitePreviewSelection =
          websitePreviewSelectionRef.current ?? websitePreviewSelection
        if (
          sourceDraft.sourceType === 'websiteCrawl' &&
          latestWebsitePreviewSelection?.draft.sourceType === 'websiteCrawl' &&
          latestWebsitePreviewSelection.selectedPageIds.length > 0
        ) {
          try {
            await importSelectedWebsitePages(
              created.control_space_id,
              latestWebsitePreviewSelection,
            )
            await queryClient.invalidateQueries({
              queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
            })
            await queryClient.invalidateQueries({
              queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.documents.get.key(),
            })
            replaceAfterHistoryGuard(newKnowledgeDetailPath(created.control_space_id))
          } catch {
            toast.error(t(($) => $['newKnowledge.addSourceFailed']))
          }
          return
        }
        try {
          const sourceDraftKey = createRequestId()
          globalThis.sessionStorage.setItem(
            newKnowledgeSourceDraftStorageKey(sourceDraftKey),
            JSON.stringify(sourceDraft),
          )
          replaceAfterHistoryGuard(
            newKnowledgeAddSourcePath(
              created.control_space_id,
              sourceDraft.sourceType,
              sourceDraftKey,
            ),
          )
        } catch {
          toast.error(t(($) => $['newKnowledge.addSourceFailed']))
        }
        return
      }

      replaceAfterHistoryGuard(
        startMode === 'upload'
          ? newKnowledgeDocumentsPath(created.control_space_id)
          : newKnowledgeDetailPath(created.control_space_id),
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
            <div className="min-h-6 w-full max-w-190 flex-1 [@media(max-height:850px)]:h-6 [@media(max-height:850px)]:flex-none" />
            <Form
              className="flex max-h-full min-h-0 w-full max-w-190 flex-col"
              onFormSubmit={() => void handleSubmit()}
            >
              <header className="shrink-0 px-6 pt-2 pb-6 sm:px-10">
                <DialogTitle id={dialogTitleId} className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['newKnowledge.createTitle'])}
                </DialogTitle>
              </header>

              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 sm:px-10">
                <div className="space-y-4">
                  <Field
                    name="name"
                    className="gap-1.5"
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
                    <FieldControl
                      autoComplete="off"
                      disabled={submissionLocked}
                      maxLength={NAME_MAX_LENGTH}
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
                    <FieldError match="customError" />
                  </Field>
                  <Field name="description" className="gap-1.5">
                    <FieldLabel>
                      {t(($) => $['newKnowledge.description'])}{' '}
                      {tCommon(($) => $['label.optional'])}
                    </FieldLabel>
                    <Textarea
                      autoComplete="off"
                      className="min-h-20"
                      disabled={submissionLocked}
                      maxLength={DESCRIPTION_MAX_LENGTH}
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
                  </Field>
                  <div className="space-y-1.5">
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

                <Fieldset>
                  <FieldsetLegend className="py-0 system-md-semibold">
                    {t(($) => $['newKnowledge.startWith'])}
                  </FieldsetLegend>
                  <p className="pb-0.5 body-xs-regular text-text-tertiary">
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
                    >
                      <CreateSourceSetup
                        disabled={submissionLocked}
                        draft={sourceDraft}
                        onDraftChange={(value) => {
                          sourceDraftsRef.current[value.sourceType] = value
                          setSourceDraft(value)
                          updateWebsitePreviewSelection(undefined)
                          resetUnsubmittedError()
                        }}
                        onWebsitePreviewSelectionChange={updateWebsitePreviewSelection}
                        onSourceTypeChange={(value) => {
                          sourceDraftsRef.current[sourceDraft.sourceType] = sourceDraft
                          const nextDraft =
                            sourceDraftsRef.current[value] ?? createNewKnowledgeSourceDraft(value)
                          sourceDraftsRef.current[value] = nextDraft
                          setSourceDraft(nextDraft)
                          updateWebsitePreviewSelection(undefined)
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
                        uploading={uploading}
                        onChange={(value) => {
                          setUploads(value)
                          resetUnsubmittedError()
                        }}
                      />
                    </StartMode>
                  </RadioGroup>
                </Fieldset>

                {createMutation.isError && (
                  <div
                    className="mt-5 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 system-sm-regular text-text-destructive"
                    role="alert"
                  >
                    {createErrorMessage}
                  </div>
                )}
                {uploadError && (
                  <div
                    className="mt-5 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 system-sm-regular text-text-destructive"
                    role="alert"
                  >
                    {t(($) => $['newKnowledge.documentUploadFailed'])}
                  </div>
                )}
              </div>

              <div className="shrink-0 px-6 pt-5 pb-10 sm:px-10">
                <div className="flex justify-end gap-2">
                  <Button type="button" disabled={submissionPending} onClick={requestClose}>
                    {tCommon(($) => $['operation.cancel'])}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={submissionPending}
                    disabled={uploadSubmissionBlocked || sourceSubmissionBlocked}
                  >
                    {t(($) => $['newKnowledge.createTitle'])}
                  </Button>
                </div>
              </div>
            </Form>
            <div className="min-h-px w-full max-w-190 flex-1 [@media(max-height:850px)]:h-6 [@media(max-height:850px)]:flex-none" />
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
