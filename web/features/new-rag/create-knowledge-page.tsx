'use client'

import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
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
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { newKnowledgeDetailPath } from './routes'

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
  disabled = false,
  icon,
  title,
  value,
}: {
  description: string
  disabled?: boolean
  icon: string
  title: string
  value: string
}) {
  const { t } = useTranslation('dataset')
  const titleId = useId()
  const descriptionId = useId()
  const unavailableId = useId()

  return (
    <RadioItem
      value={value}
      nativeButton
      render={<button type="button" />}
      aria-labelledby={titleId}
      aria-describedby={disabled ? `${descriptionId} ${unavailableId}` : descriptionId}
      disabled={disabled}
      className={cn(
        'relative flex min-h-16 w-full items-center gap-3 overflow-hidden rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg px-4 py-3.5 text-left outline-hidden transition-colors motion-reduce:transition-none',
        'hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid',
        'data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg',
        'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:bg-components-option-card-option-bg',
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
      {disabled && (
        <span id={unavailableId} className="ml-3 system-xs-medium text-text-disabled">
          {t(($) => $['cornerLabel.unavailable'])}
        </span>
      )}
    </RadioItem>
  )
}

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
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
      router.replace(newKnowledgeDetailPath(created.id))
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
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background-default">
      <header className="flex h-13 shrink-0 items-center border-b border-divider-subtle pr-4 pl-2">
        <button
          type="button"
          aria-label={tCommon(($) => $['operation.back'])}
          className="mr-1 flex size-8 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => router.back()}
          disabled={createMutation.isPending}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
        </button>
        <h1 className="system-sm-semibold text-text-primary">
          {t(($) => $['newKnowledge.createTitle'])}
        </h1>
      </header>
      <Form
        className="w-full max-w-[800px] px-4 py-8 sm:px-20 sm:py-10"
        onFormSubmit={handleSubmit}
      >
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
            <FieldError match="valueMissing">{t(($) => $['newKnowledge.nameRequired'])}</FieldError>
            <FieldError match="customError" />
          </Field>
          <Field name="description" className="gap-1.5">
            <FieldLabel>
              {t(($) => $['newKnowledge.description'])}
              <span className="ml-1 system-xs-regular text-text-tertiary">
                {tCommon(($) => $['label.optional'])}
              </span>
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
                  <SelectItemText>{t(($) => $['newKnowledge.permissionOnlyMe'])}</SelectItemText>
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
              <p id={permissionDescriptionId} className="py-0.5 body-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.permissionRestricted'])}
              </p>
            )}
          </div>
        </div>

        <fieldset className="mt-7">
          <legend className="system-md-semibold text-text-secondary">
            {t(($) => $['newKnowledge.startWith'])}
          </legend>
          <p className="pb-0.5 body-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.startWithHelp'])}
          </p>
          <RadioGroup
            value="empty"
            aria-label={t(($) => $['newKnowledge.startWith'])}
            className="mt-2 flex-col items-stretch gap-2"
            onValueChange={() => undefined}
          >
            <StartMode
              value="empty"
              icon="i-ri-folder-6-line"
              title={t(($) => $['newKnowledge.startEmpty'])}
              description={t(($) => $['newKnowledge.startEmptyDescription'])}
            />
            <StartMode
              disabled
              value="source"
              icon="i-custom-vender-solid-development-api-connection-mod"
              title={t(($) => $['newKnowledge.connectSource'])}
              description={t(($) => $['newKnowledge.connectSourceDescription'])}
            />
            <StartMode
              disabled
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

        <div className="mt-7 flex justify-end gap-2">
          <Button type="button" disabled={createMutation.isPending} onClick={() => router.back()}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button type="submit" variant="primary" loading={createMutation.isPending}>
            {t(($) => $['newKnowledge.createTitle'])}
          </Button>
        </div>
      </Form>
    </main>
  )
}
