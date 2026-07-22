'use client'

import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { QueuedUpload } from './create-upload-queue'
import type {
  NewKnowledgeSourceDraft,
  NewKnowledgeSourceType,
  NewKnowledgeStartMode,
} from './routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
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
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { CreateSourceSetup } from './create-source-setup'
import { CreateUploadQueue } from './create-upload-queue'
import {
  isValidWebsiteSourceDraft,
  newKnowledgeAddSourcePath,
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeSourceDraftStorageKey,
} from './routes'

const NAME_MAX_LENGTH = 160
const DESCRIPTION_MAX_LENGTH = 2000
const DEFAULT_SOURCE_PROVIDER: Record<NewKnowledgeSourceType, string> = {
  onlineDocuments: 'Notion',
  onlineDrive: 'Google Drive',
  websiteCrawl: 'Firecrawl',
}

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

function StartMode({
  children,
  description,
  icon,
  selected,
  title,
  value,
}: {
  children?: ReactNode
  description: string
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
          : 'border-components-option-card-option-border hover:bg-state-base-hover',
      )}
    >
      <RadioItem
        value={value}
        nativeButton
        render={<button type="button" />}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative flex min-h-16 w-full items-center gap-3 px-4 py-3.5 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
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

async function uploadCreatedDocuments(knowledgeSpaceId: string, files: File[]) {
  if (files.length === 1) {
    await consoleClient.knowledgeFs.postKnowledgeSpacesByIdDocuments({
      body: { file: files[0]! },
      params: { id: knowledgeSpaceId },
    })
    return
  }

  const result = await consoleClient.knowledgeFs.postKnowledgeSpacesByIdDocumentsBulk({
    body: { files },
    params: { id: knowledgeSpaceId },
  })
  if (!result.accepted) throw new Error('No files were accepted')
  return result
}

function KnowledgeIllustration({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col bg-background-default" aria-hidden>
      <div className="flex min-h-0 flex-[0.44] flex-col justify-end border-b border-divider-subtle px-8 pb-5">
        <span className="mb-4 flex size-14 items-center justify-center rounded-xl border border-divider-subtle text-text-accent">
          <span className="i-ri-book-open-line size-6" />
        </span>
        <p className="max-w-[600px] system-xl-medium text-text-primary">{title}</p>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background-section-burn">
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
      <div className="min-h-0 flex-[0.28] bg-background-default" />
    </div>
  )
}

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const permissionDescriptionId = useId()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canConfigureAccess = hasPermission(
    workspacePermissionKeys,
    DatasetACLPermission.AccessConfig,
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(() =>
    canConfigureAccess ? 'all_members' : 'only_me',
  )
  const [startMode, setStartMode] = useState<NewKnowledgeStartMode>(() =>
    normalizeStartMode(searchParams.get('start')),
  )
  const [sourceType, setSourceType] = useState<NewKnowledgeSourceType>('websiteCrawl')
  const [sourceDraft, setSourceDraft] = useState<NewKnowledgeSourceDraft>({
    includeSubpages: true,
    maxPages: 100,
    provider: DEFAULT_SOURCE_PROVIDER.websiteCrawl,
    rootUrl: '',
    sourceName: '',
  })
  const [uploads, setUploads] = useState<QueuedUpload[]>([])
  const [createdKnowledge, setCreatedKnowledge] = useState<KnowledgeSpaceCreationResponse>()
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(false)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })
  const submissionPending = createMutation.isPending || uploading
  const uploadSubmissionBlocked =
    startMode === 'upload' && (!uploads.length || uploads.some((upload) => upload.issue))
  const sourceSubmissionBlocked =
    startMode === 'source' &&
    sourceType === 'websiteCrawl' &&
    !isValidWebsiteSourceDraft(sourceDraft, { allowEmpty: true })

  const resetUnsubmittedError = () => {
    if (!submissionLocked) createMutation.reset()
    setUploadError(false)
  }

  const cancel = () => {
    if (createdKnowledge) {
      router.replace(newKnowledgeDocumentsPath(createdKnowledge.id))
      return
    }
    router.back()
  }

  const handleSubmit = async () => {
    if (submissionPending || uploadSubmissionBlocked || sourceSubmissionBlocked) return

    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    if (!normalizedName) return

    idempotencyKeyRef.current ??= globalThis.crypto.randomUUID()
    setSubmissionLocked(true)
    try {
      const created = await createMutation.mutateAsync({
        existingKnowledge: createdKnowledge,
        description: normalizedDescription,
        idempotencyKey: idempotencyKeyRef.current,
        name: normalizedName,
        onCreated: setCreatedKnowledge,
        visibility,
      })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.listKnowledgeSpaces.key(),
      })
      if (startMode === 'upload') {
        setUploading(true)
        setUploadError(false)
        try {
          const result = await uploadCreatedDocuments(
            created.id,
            uploads.map((upload) => upload.file),
          )
          if (result?.excluded)
            toast.warning(
              t(($) => $['newKnowledge.documentUploadPartial'], {
                accepted: result.accepted,
                details: result.items
                  .filter((item) => 'reason' in item)
                  .map((item) => item.filename)
                  .join(', '),
                excluded: result.excluded,
              }),
            )
        } catch {
          setUploadError(true)
          return
        } finally {
          setUploading(false)
        }
      }
      let sourceDraftKey: string | undefined
      const hasWebsiteSourceDraft =
        startMode === 'source' &&
        sourceType === 'websiteCrawl' &&
        Boolean(
          sourceDraft.rootUrl.length ||
          sourceDraft.sourceName.length ||
          !sourceDraft.includeSubpages ||
          sourceDraft.maxPages !== 100,
        )
      if (hasWebsiteSourceDraft) {
        try {
          sourceDraftKey = globalThis.crypto.randomUUID()
          globalThis.sessionStorage.setItem(
            newKnowledgeSourceDraftStorageKey(sourceDraftKey),
            JSON.stringify(sourceDraft),
          )
        } catch {
          toast.error(t(($) => $['newKnowledge.addSourceFailed']))
          return
        }
      }
      router.replace(
        startMode === 'source'
          ? newKnowledgeAddSourcePath(created.id, sourceType, sourceDraftKey)
          : startMode === 'upload'
            ? newKnowledgeDocumentsPath(created.id)
            : newKnowledgeDetailPath(created.id),
      )
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
      // The mutation state renders a retryable, localized error without exposing upstream details.
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submissionPending) cancel()
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="bg-background-overlay-alt/70" />
        <DialogPopup className="fixed inset-x-3 top-4 bottom-4 grid min-h-0 min-w-0 overflow-hidden border-effects-highlight bg-background-default p-0 shadow-lg xl:grid-cols-2">
          <DialogCloseButton
            aria-label={tCommon(($) => $['operation.close'])}
            disabled={submissionPending}
            className="top-3 right-3 size-9 rounded-xl bg-background-section-burn text-text-tertiary"
          />

          <div className="flex min-h-0 min-w-0 flex-col border-divider-subtle xl:border-r">
            <div className="h-6 shrink-0" />
            <Form className="flex min-h-0 flex-1 flex-col" onFormSubmit={handleSubmit}>
              <header className="shrink-0 px-6 py-2 sm:px-10">
                <DialogTitle className="system-xl-semibold text-text-primary">
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
                        aria-describedby={!canConfigureAccess ? permissionDescriptionId : undefined}
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
                      icon="i-ri-folder-6-line"
                      selected={startMode === 'empty'}
                      title={t(($) => $['newKnowledge.startEmpty'])}
                      description={t(($) => $['newKnowledge.startEmptyDescription'])}
                    />
                    <StartMode
                      value="source"
                      icon="i-custom-vender-solid-development-api-connection-mod"
                      selected={startMode === 'source'}
                      title={t(($) => $['newKnowledge.connectSource'])}
                      description={t(($) => $['newKnowledge.connectSourceDescription'])}
                    >
                      <CreateSourceSetup
                        disabled={submissionLocked}
                        draft={sourceDraft}
                        onDraftChange={(value) => {
                          setSourceDraft(value)
                          resetUnsubmittedError()
                        }}
                        sourceType={sourceType}
                        onSourceTypeChange={(value) => {
                          setSourceType(value)
                          setSourceDraft((current) => ({
                            ...current,
                            provider: DEFAULT_SOURCE_PROVIDER[value],
                          }))
                          resetUnsubmittedError()
                        }}
                      />
                    </StartMode>
                    <StartMode
                      value="upload"
                      icon="i-ri-file-text-line"
                      selected={startMode === 'upload'}
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
                </fieldset>

                {createMutation.isError && (
                  <div
                    className="mt-5 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 system-sm-regular text-text-destructive"
                    role="alert"
                  >
                    {t(($) => $['newKnowledge.createFailed'])}
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

              <div className="shrink-0 border-t border-divider-subtle px-6 py-5 sm:px-10">
                <div className="flex justify-end gap-2">
                  <Button type="button" disabled={submissionPending} onClick={cancel}>
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
              <div className="h-6 shrink-0" />
            </Form>
          </div>

          <aside className="hidden min-h-0 min-w-0 xl:block">
            <KnowledgeIllustration title={t(($) => $['newKnowledge.createIllustrationTitle'])} />
          </aside>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
