'use client'

import type {
  KnowledgeSpaceCreationResponse,
  Source,
  WebsiteCrawlResult,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { SelectedFile } from './components/file-upload-selection'
import type { NewKnowledgeStartMode } from './routes'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
import { Form } from '@langgenius/dify-ui/form'
import { RadioControl, RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
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
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { FileUploadSelection } from './components/file-upload-selection'
import { SourceConfiguration } from './components/source-configuration'
import { newKnowledgeDetailPath, newKnowledgeDocumentsPath } from './routes'
import { uploadKnowledgeDocument } from './service'

const NAME_MAX_LENGTH = 160
const DESCRIPTION_MAX_LENGTH = 2000

type KnowledgeVisibility = 'all_members' | 'only_me'

type CreateKnowledgeValues = {
  existingKnowledge?: KnowledgeSpaceCreationResponse
  description: string
  idempotencyKey: string
  name: string
  onCreated: (knowledgeSpace: KnowledgeSpaceCreationResponse) => void
  visibility: KnowledgeVisibility
}

class KnowledgeCreationError extends Error {
  readonly stage: 'create' | 'policy'
  readonly originalError: unknown
  readonly createdKnowledge?: KnowledgeSpaceCreationResponse

  constructor(
    stage: 'create' | 'policy',
    originalError: unknown,
    createdKnowledge?: KnowledgeSpaceCreationResponse,
  ) {
    super(`Knowledge creation failed during ${stage}`)
    this.name = 'KnowledgeCreationError'
    this.stage = stage
    this.originalError = originalError
    this.createdKnowledge = createdKnowledge
  }
}

function responseStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error) return error.status
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data) return data.status
  }
}

function isDefinitiveCreationRejection(error: unknown) {
  const status = responseStatus(error)
  return status === 400 || status === 401 || status === 403 || status === 422
}

async function createKnowledge(
  values: CreateKnowledgeValues,
): Promise<KnowledgeSpaceCreationResponse> {
  let created = values.existingKnowledge
  if (!created) {
    try {
      created = await consoleClient.knowledgeFs.createKnowledgeSpace({
        body: {
          description: values.description || undefined,
          idempotencyKey: values.idempotencyKey,
          name: values.name,
        },
      })
    } catch (error) {
      throw new KnowledgeCreationError('create', error)
    }
  }
  values.onCreated(created)

  try {
    if (values.visibility === 'all_members') {
      const policy = await consoleClient.knowledgeFs.getKnowledgeSpacesByIdAccessPolicy({
        params: { id: created.id },
      })
      if (policy.visibility !== values.visibility) {
        await consoleClient.knowledgeFs.patchKnowledgeSpacesByIdAccessPolicy({
          body: {
            expectedRevision: policy.revision,
            partialMemberSubjectIds: [],
            visibility: values.visibility,
          },
          params: { id: created.id },
        })
      }
    }
  } catch (error) {
    throw new KnowledgeCreationError('policy', error, created)
  }

  return created
}

async function createWebsiteSource({
  knowledgeSpaceId,
  name,
  providerId,
  url,
}: {
  knowledgeSpaceId: string
  name: string
  providerId: string
  url: string
}) {
  return consoleClient.knowledgeFs.postKnowledgeSpacesByIdSources({
    body: {
      metadata: { providerId },
      name,
      type: 'web',
      uri: new URL(url).toString(),
    },
    params: { id: knowledgeSpaceId },
  })
}

async function crawlWebsiteSource({
  knowledgeSpaceId,
  sourceId,
}: {
  knowledgeSpaceId: string
  sourceId: string
}) {
  return consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourcesBySourceIdCrawl({
    params: { id: knowledgeSpaceId, sourceId },
  })
}

async function uploadDocuments({
  files,
  knowledgeSpaceId,
}: {
  files: File[]
  knowledgeSpaceId: string
}) {
  return Promise.all(files.map((file) => uploadKnowledgeDocument({ file, knowledgeSpaceId })))
}

function StartMode({
  children,
  description,
  disabled,
  icon,
  selected,
  title,
  value,
}: {
  children?: ReactNode
  description: string
  disabled: boolean
  icon: string
  selected: boolean
  title: string
  value: NewKnowledgeStartMode
}) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-components-option-card-option-bg transition-colors motion-reduce:transition-none',
        selected
          ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg'
          : 'border-components-option-card-option-border',
      )}
    >
      <RadioItem
        value={value}
        nativeButton
        disabled={disabled}
        render={<button type="button" />}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          'relative flex min-h-16 w-full items-center gap-3 rounded-none border-0 px-4 py-3.5 text-left outline-hidden',
          'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <RadioControl aria-hidden />
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-components-option-card-option-border bg-background-default">
          <span aria-hidden className={`${icon} size-[18px] text-text-tertiary`} />
        </span>
        <span className="min-w-0 flex-1">
          <span id={titleId} className="block system-sm-medium text-text-primary">
            {title}
          </span>
          <span id={descriptionId} className="mt-0.5 block system-xs-regular text-text-tertiary">
            {description}
          </span>
        </span>
      </RadioItem>
      {selected && children}
    </div>
  )
}

function normalizeStartMode(value: string | null): NewKnowledgeStartMode {
  if (value === 'source' || value === 'upload') return value
  return 'empty'
}

function KnowledgeIllustration({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col bg-background-default" aria-hidden>
      <div className="flex min-h-[350px] shrink-0 flex-col justify-end border-b border-divider-subtle px-8 pb-5">
        <span className="mb-4 flex size-14 items-center justify-center rounded-xl border border-divider-subtle text-text-accent">
          <span className="i-ri-book-open-line size-6" />
        </span>
        <p className="max-w-[600px] system-xl-medium text-text-primary">{title}</p>
      </div>
      <div className="relative min-h-[360px] flex-1 overflow-hidden bg-background-section-burn">
        <svg
          className="absolute inset-0 size-full text-text-accent"
          viewBox="0 0 760 560"
          fill="none"
          preserveAspectRatio="xMidYMid slice"
        >
          <g stroke="currentColor">
            <path d="M-120 70 700 560" opacity=".22" />
            <path d="M-70 -80 820 450" opacity=".35" />
            <path d="M170 -80 790 285" opacity=".55" />
            <path d="M495 -110 835 90" opacity=".9" strokeWidth="2" />
            <path d="M-80 245 610 655" opacity=".22" />
            <path d="M-40 405 360 645" opacity=".28" />
            <path
              d="M-90 12C160 130 392 274 620 415c80 49 60 148-3 245"
              opacity=".45"
              strokeDasharray="10 8"
            />
            <path d="M95 610C220 350 340 100 500-110" opacity=".2" />
            <path d="M310 630C470 315 600 95 760-170" opacity=".35" />
            <path d="M655 590C720 420 790 245 870 80" opacity=".95" strokeWidth="2" />
            <circle cx="581" cy="163" r="28" opacity=".9" strokeWidth="2" />
            <circle cx="581" cy="163" r="7" opacity=".9" />
            <circle cx="440" cy="441" r="35" opacity=".9" strokeWidth="2" />
            <circle cx="440" cy="441" r="16" opacity=".9" strokeWidth="2" />
          </g>
          <g fill="currentColor">
            {Array.from({ length: 8 }, (_, row) =>
              Array.from({ length: 10 }, (_, column) => (
                <circle
                  key={`${row}-${column}`}
                  cx={220 + column * 11}
                  cy={210 + row * 11}
                  r="1.5"
                  opacity=".8"
                />
              )),
            )}
          </g>
        </svg>
      </div>
      <div className="min-h-[260px] flex-1 bg-background-default" />
    </div>
  )
}

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const dialogTitleId = useId()
  const permissionDescriptionId = useId()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canConfigureAccess = hasPermission(
    workspacePermissionKeys,
    DatasetACLPermission.AccessConfig,
  )
  const canConnectExternalSource = hasPermission(
    workspacePermissionKeys,
    'dataset.external.connect',
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(() =>
    canConfigureAccess ? 'all_members' : 'only_me',
  )
  const [startMode, setStartMode] = useState<NewKnowledgeStartMode>(() => {
    const requestedStartMode = normalizeStartMode(searchParams.get('start'))
    return requestedStartMode === 'source' && !canConnectExternalSource
      ? 'empty'
      : requestedStartMode
  })
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [sourceProviderId, setSourceProviderId] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([])
  const [createdKnowledge, setCreatedKnowledge] = useState<KnowledgeSpaceCreationResponse>()
  const [createdSource, setCreatedSource] = useState<Source>()
  const [crawlPreview, setCrawlPreview] = useState<WebsiteCrawlResult>()
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })
  const sourceMutation = useMutation({ mutationFn: createWebsiteSource })
  const crawlMutation = useMutation({ mutationFn: crawlWebsiteSource })
  const uploadMutation = useMutation({ mutationFn: uploadDocuments })
  const isPending =
    createMutation.isPending ||
    sourceMutation.isPending ||
    crawlMutation.isPending ||
    uploadMutation.isPending
  const hasInvalidFiles = selectedFiles.some(({ error }) => error)
  const isDirty =
    Boolean(name || description || sourceUrl || sourceName || selectedFiles.length) ||
    visibility !== (canConfigureAccess ? 'all_members' : 'only_me') ||
    startMode !== 'empty'

  const resetUnsubmittedError = () => {
    if (!submissionLocked) createMutation.reset()
  }

  const createKnowledgeFromForm = async () => {
    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    if (!normalizedName) return undefined

    idempotencyKeyRef.current ??= globalThis.crypto.randomUUID()
    setSubmissionLocked(true)
    try {
      return await createMutation.mutateAsync({
        existingKnowledge: createdKnowledge,
        description: normalizedDescription,
        idempotencyKey: idempotencyKeyRef.current,
        name: normalizedName,
        onCreated: setCreatedKnowledge,
        visibility,
      })
    } catch (error) {
      if (error instanceof KnowledgeCreationError && error.createdKnowledge)
        setCreatedKnowledge(error.createdKnowledge)

      if (
        error instanceof KnowledgeCreationError &&
        error.stage === 'create' &&
        isDefinitiveCreationRejection(error.originalError)
      ) {
        idempotencyKeyRef.current = undefined
        setSubmissionLocked(false)
      }
      throw error
    }
  }

  const runSourceSetup = async (created: KnowledgeSpaceCreationResponse) => {
    let source = createdSource
    if (!source) {
      source = await sourceMutation.mutateAsync({
        knowledgeSpaceId: created.id,
        name: sourceName.trim(),
        providerId: sourceProviderId,
        url: sourceUrl.trim(),
      })
      setCreatedSource(source)
    }
    const preview = await crawlMutation.mutateAsync({
      knowledgeSpaceId: created.id,
      sourceId: source.id,
    })
    setCrawlPreview(preview)
  }

  const handlePreview = async () => {
    if (isPending || !sourceName.trim() || !sourceUrl.trim() || !sourceProviderId) return
    try {
      const created = await createKnowledgeFromForm()
      if (created) await runSourceSetup(created)
    } catch {
      // The shared error state keeps this workflow retryable.
    }
  }

  const handleSubmit = async () => {
    if (isPending || (startMode === 'upload' && (!selectedFiles.length || hasInvalidFiles))) return

    try {
      const created = await createKnowledgeFromForm()
      if (!created) return
      if (startMode === 'source') {
        if (!sourceName.trim() || !sourceUrl.trim() || !sourceProviderId) return
        if (!crawlPreview) await runSourceSetup(created)
      }
      if (startMode === 'upload') {
        await uploadMutation.mutateAsync({
          files: selectedFiles.map(({ file }) => file),
          knowledgeSpaceId: created.id,
        })
      }
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.listKnowledgeSpaces.key(),
      })
      router.replace(
        startMode === 'upload'
          ? newKnowledgeDocumentsPath(created.id)
          : newKnowledgeDetailPath(created.id),
      )
    } catch {
      // The mutation state renders a retryable, localized error without exposing upstream details.
    }
  }

  const requestClose = () => {
    if (isPending) return
    if (isDirty) {
      setDiscardOpen(true)
      return
    }
    router.back()
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="fixed inset-x-3 top-4 bottom-4 grid min-h-0 min-w-0 overflow-hidden xl:grid-cols-2">
            <button
              type="button"
              aria-label={tCommon(($) => $['operation.close'])}
              className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-xl bg-background-section-burn text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
              onClick={requestClose}
              disabled={isPending}
            >
              <span aria-hidden className="i-ri-close-line size-5" />
            </button>

            <div className="flex min-h-0 min-w-0 flex-col border-divider-subtle xl:border-r">
              <div className="h-6 shrink-0" />
              <Form className="flex min-h-0 flex-1 flex-col" onFormSubmit={handleSubmit}>
                <header className="shrink-0 px-6 py-2 sm:px-10">
                  <DialogTitle id={dialogTitleId} className="system-xl-semibold text-text-primary">
                    {t(($) => $['newKnowledge.createTitle'])}
                  </DialogTitle>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-8 sm:px-10">
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
                      <FieldLabel>{t(($) => $['newKnowledge.description'])}</FieldLabel>
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
                          aria-describedby={
                            !canConfigureAccess ? permissionDescriptionId : undefined
                          }
                        >
                          {t(($) =>
                            visibility === 'all_members'
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
                          <SelectItem value="all_members">
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

                  <fieldset className="mt-6">
                    <legend className="system-md-semibold text-text-secondary">
                      {t(($) => $['newKnowledge.startWith'])}
                    </legend>
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
                        disabled={false}
                        icon="i-ri-folder-6-line"
                        selected={startMode === 'empty'}
                        title={t(($) => $['newKnowledge.startEmpty'])}
                        description={t(($) => $['newKnowledge.startEmptyDescription'])}
                      />
                      <StartMode
                        value="source"
                        disabled={!canConnectExternalSource}
                        icon="i-custom-vender-solid-development-api-connection-mod"
                        selected={startMode === 'source'}
                        title={t(($) => $['newKnowledge.connectSource'])}
                        description={t(($) => $['newKnowledge.connectSourceDescription'])}
                      >
                        <SourceConfiguration
                          disabled={submissionLocked}
                          name={sourceName}
                          onNameChange={setSourceName}
                          onPreview={() => void handlePreview()}
                          onProviderChange={setSourceProviderId}
                          onUrlChange={setSourceUrl}
                          previewPages={crawlPreview?.pages ?? []}
                          previewPending={sourceMutation.isPending || crawlMutation.isPending}
                          providerId={sourceProviderId}
                          url={sourceUrl}
                        />
                      </StartMode>
                      <StartMode
                        value="upload"
                        disabled={false}
                        icon="i-ri-file-text-line"
                        selected={startMode === 'upload'}
                        title={t(($) => $['newKnowledge.uploadFiles'])}
                        description={t(($) => $['newKnowledge.uploadFilesDescription'])}
                      >
                        <FileUploadSelection
                          disabled={submissionLocked}
                          files={selectedFiles}
                          onChange={setSelectedFiles}
                        />
                      </StartMode>
                    </RadioGroup>
                  </fieldset>

                  {(createMutation.isError ||
                    sourceMutation.isError ||
                    crawlMutation.isError ||
                    uploadMutation.isError) && (
                    <div
                      className="mt-5 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 system-sm-regular text-text-destructive"
                      role="alert"
                    >
                      {t(($) => $['newKnowledge.createFailed'])}
                    </div>
                  )}
                </div>

                <div className="shrink-0 border-t border-divider-subtle px-6 py-5 sm:px-10">
                  <div className="flex justify-end gap-2">
                    <Button type="button" disabled={isPending} onClick={requestClose}>
                      {tCommon(($) => $['operation.cancel'])}
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      loading={isPending}
                      disabled={
                        (startMode === 'source' &&
                          (!sourceUrl.trim() || !sourceName.trim() || !sourceProviderId)) ||
                        (startMode === 'upload' && (!selectedFiles.length || hasInvalidFiles))
                      }
                    >
                      {t(($) => $['newKnowledge.createTitle'])}
                    </Button>
                  </div>
                </div>
                <div className="h-6 shrink-0" />
              </Form>
            </div>

            <aside className="hidden min-h-0 min-w-0 xl:block">
              <KnowledgeIllustration title={t(($) => $['newKnowledge.illustrationHeadline'])} />
            </aside>
          </DialogPopup>
        </DialogPortal>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <div className="p-6 pb-0">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['newKnowledge.discardTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.discardDescription'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton tone="destructive" onClick={() => router.back()}>
              {tCommon(($) => $['operation.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
