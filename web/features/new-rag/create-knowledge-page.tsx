'use client'

import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
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

async function createKnowledge(
  values: CreateKnowledgeValues,
): Promise<KnowledgeSpaceCreationResponse> {
  const created =
    values.existingKnowledge ??
    (await consoleClient.knowledgeFs.createKnowledgeSpace({
      body: {
        description: values.description || undefined,
        idempotencyKey: values.idempotencyKey,
        name: values.name,
      },
    }))
  values.onCreated(created)

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

  return created
}

function StartMode({
  description,
  disabled = false,
  icon,
  selected = false,
  title,
}: {
  description: string
  disabled?: boolean
  icon: string
  selected?: boolean
  title: string
}) {
  const { t } = useTranslation('dataset')

  return (
    <button
      type="button"
      aria-label={title}
      aria-pressed={selected}
      disabled={disabled}
      className="relative flex min-h-16 w-full items-center rounded-xl border-[0.5px] border-components-card-border bg-components-card-bg px-3 py-2.5 text-left outline-hidden transition-colors hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:bg-components-input-bg-disabled motion-reduce:transition-none"
    >
      <span className="mr-3 flex size-9 shrink-0 items-center justify-center rounded-lg bg-background-section">
        <span aria-hidden className={`${icon} size-4 text-text-tertiary`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block system-sm-semibold text-text-secondary">{title}</span>
        <span className="mt-0.5 block system-xs-regular text-text-tertiary">{description}</span>
      </span>
      {selected && (
        <span aria-hidden className="i-ri-checkbox-circle-fill size-4 text-text-accent" />
      )}
      {disabled && (
        <span className="ml-3 system-xs-medium text-text-disabled">
          {t(($) => $['cornerLabel.unavailable'])}
        </span>
      )}
    </button>
  )
}

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const queryClient = useQueryClient()
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
    } catch {
      // The mutation state renders a retryable, localized error without exposing upstream details.
    }
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background-body">
      <header className="flex h-13 shrink-0 items-center border-b border-divider-subtle px-3 sm:px-5">
        <button
          type="button"
          aria-label={tCommon(($) => $['operation.back'])}
          className="mr-2 flex size-8 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={() => router.back()}
          disabled={createMutation.isPending}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
        </button>
        <h1 className="title-lg-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.createTitle'])}
        </h1>
      </header>
      <Form
        className="w-full max-w-[800px] px-4 py-8 sm:px-20 sm:py-10"
        onFormSubmit={handleSubmit}
      >
        <div className="space-y-5">
          <Field
            name="name"
            className="gap-2"
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
          <Field name="description" className="gap-2">
            <FieldLabel>
              {t(($) => $['newKnowledge.description'])}
              <span className="ml-1 system-xs-regular text-text-tertiary">
                {tCommon(($) => $['label.optional'])}
              </span>
            </FieldLabel>
            <Textarea
              autoComplete="off"
              className="min-h-20 resize-none"
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
            <div className="flex items-start justify-between gap-3">
              <FieldDescription>{t(($) => $['newKnowledge.descriptionHelp'])}</FieldDescription>
              <span className="shrink-0 py-0.5 system-xs-regular text-text-quaternary">
                {description.length}/{DESCRIPTION_MAX_LENGTH}
              </span>
            </div>
          </Field>
          <Field name="permission" className="gap-2" disabled={!canConfigureAccess}>
            <FieldLabel>{t(($) => $['newKnowledge.permission'])}</FieldLabel>
            <Select
              name="permission"
              value={visibility}
              disabled={!canConfigureAccess}
              onValueChange={(value) => {
                if (value) setVisibility(value)
              }}
            >
              <SelectTrigger aria-label={t(($) => $['newKnowledge.permission'])}>
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
              <FieldDescription>
                {t(($) => $['newKnowledge.permissionRestricted'])}
              </FieldDescription>
            )}
          </Field>
        </div>

        <fieldset className="mt-8 space-y-2">
          <legend className="mb-2 system-xs-medium-uppercase text-text-tertiary">
            {t(($) => $['newKnowledge.startWith'])}
          </legend>
          <StartMode
            selected
            icon="i-ri-folder-6-line"
            title={t(($) => $['newKnowledge.startEmpty'])}
            description={t(($) => $['newKnowledge.startEmptyDescription'])}
          />
          <StartMode
            disabled
            icon="i-custom-vender-solid-development-api-connection-mod"
            title={t(($) => $['newKnowledge.connectSource'])}
            description={t(($) => $['newKnowledge.connectSourceDescription'])}
          />
          <StartMode
            disabled
            icon="i-ri-upload-2-line"
            title={t(($) => $['newKnowledge.uploadFiles'])}
            description={t(($) => $['newKnowledge.uploadFilesDescription'])}
          />
        </fieldset>

        {createMutation.isError && (
          <div
            className="mt-5 rounded-lg bg-components-badge-status-light-error-bg px-3 py-2 system-sm-regular text-text-destructive"
            role="alert"
          >
            {t(($) => $['newKnowledge.createFailed'])}
          </div>
        )}

        <div className="mt-8 flex justify-end gap-2 border-t border-divider-subtle pt-5">
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
