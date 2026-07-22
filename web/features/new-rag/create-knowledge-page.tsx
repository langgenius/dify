'use client'

import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
import type { NewKnowledgeStartMode } from './routes'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
import {
  newKnowledgeAddSourcePath,
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
} from './routes'

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

function StartMode({
  description,
  icon,
  title,
  value,
}: {
  description: string
  icon: string
  title: string
  value: NewKnowledgeStartMode
}) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <RadioItem
      value={value}
      nativeButton
      render={<button type="button" />}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={cn(
        'relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg px-4 py-3.5 text-left outline-hidden transition-colors motion-reduce:transition-none',
        'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg',
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
  )
}

function normalizeStartMode(value: string | null): NewKnowledgeStartMode {
  if (value === 'source' || value === 'upload') return value
  return 'empty'
}

function KnowledgeIllustration({ title }: { title: string }) {
  return (
    <div className="flex size-full flex-col bg-background-default" aria-hidden>
      <div className="flex min-h-[450px] shrink-0 flex-col justify-end border-b border-divider-subtle px-8 pb-5">
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
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(() =>
    canConfigureAccess ? 'all_members' : 'only_me',
  )
  const [startMode, setStartMode] = useState<NewKnowledgeStartMode>(() =>
    normalizeStartMode(searchParams.get('start')),
  )
  const [createdKnowledge, setCreatedKnowledge] = useState<KnowledgeSpaceCreationResponse>()
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })

  const resetUnsubmittedError = () => {
    if (!submissionLocked) createMutation.reset()
  }

  const handleSubmit = async () => {
    if (createMutation.isPending) return

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
      router.replace(
        startMode === 'source'
          ? newKnowledgeAddSourcePath(created.id)
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
    <main className="fixed inset-0 z-30 bg-background-overlay-alt/70 px-3 py-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        className="relative grid size-full min-h-0 min-w-0 overflow-hidden rounded-2xl border border-effects-highlight bg-background-default shadow-lg xl:grid-cols-2"
      >
        <button
          type="button"
          aria-label={tCommon(($) => $['operation.close'])}
          className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-xl bg-background-section-burn text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
          onClick={() => router.back()}
          disabled={createMutation.isPending}
        >
          <span aria-hidden className="i-ri-close-line size-5" />
        </button>

        <div className="flex min-h-0 min-w-0 flex-col border-divider-subtle xl:border-r">
          <div className="h-6 shrink-0" />
          <Form className="flex min-h-0 flex-1 flex-col" onFormSubmit={handleSubmit}>
            <header className="shrink-0 px-6 py-2 sm:px-10">
              <h1 id={dialogTitleId} className="system-xl-semibold text-text-primary">
                {t(($) => $['newKnowledge.createTitle'])}
              </h1>
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
                  <FieldDescription>{t(($) => $['newKnowledge.descriptionHelp'])}</FieldDescription>
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
                  disabled={createMutation.isPending}
                  onValueChange={setStartMode}
                >
                  <StartMode
                    value="empty"
                    icon="i-ri-folder-6-line"
                    title={t(($) => $['newKnowledge.startEmpty'])}
                    description={t(($) => $['newKnowledge.startEmptyDescription'])}
                  />
                  <StartMode
                    value="source"
                    icon="i-custom-vender-solid-development-api-connection-mod"
                    title={t(($) => $['newKnowledge.connectSource'])}
                    description={t(($) => $['newKnowledge.connectSourceDescription'])}
                  />
                  <StartMode
                    value="upload"
                    icon="i-ri-file-text-line"
                    title={t(($) => $['newKnowledge.uploadFiles'])}
                    description={t(($) => $['newKnowledge.uploadFilesDescription'])}
                  />
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
            </div>

            <div className="shrink-0 border-t border-divider-subtle px-6 py-5 sm:px-10">
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  disabled={createMutation.isPending}
                  onClick={() => router.back()}
                >
                  {tCommon(($) => $['operation.cancel'])}
                </Button>
                <Button type="submit" variant="primary" loading={createMutation.isPending}>
                  {t(($) => $['newKnowledge.createTitle'])}
                </Button>
              </div>
            </div>
            <div className="h-6 shrink-0" />
          </Form>
        </div>

        <aside className="hidden min-h-0 min-w-0 xl:block">
          <KnowledgeIllustration title={t(($) => $['newKnowledge.connectSourceDescription'])} />
        </aside>
      </section>
    </main>
  )
}
