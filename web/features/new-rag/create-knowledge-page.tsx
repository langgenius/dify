'use client'

import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeDetailPath } from './routes'

const NAME_MAX_LENGTH = 160
const DESCRIPTION_MAX_LENGTH = 2000

type KnowledgeVisibility = 'all_members' | 'only_me'

type CreateKnowledgeValues = {
  description: string
  idempotencyKey: string
  name: string
  visibility: KnowledgeVisibility
}

async function createKnowledge(
  values: CreateKnowledgeValues,
): Promise<KnowledgeSpaceCreationResponse> {
  const created = await consoleClient.knowledgeFs.createKnowledgeSpace({
    body: {
      description: values.description || undefined,
      idempotencyKey: values.idempotencyKey,
      name: values.name,
    },
  })

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
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>('only_me')
  const [nameError, setNameError] = useState(false)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })

  const resetRequestIdentity = () => {
    idempotencyKeyRef.current = undefined
    createMutation.reset()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createMutation.isPending) return

    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    if (!normalizedName) {
      setNameError(true)
      return
    }

    setNameError(false)
    idempotencyKeyRef.current ??= globalThis.crypto.randomUUID()
    try {
      const created = await createMutation.mutateAsync({
        description: normalizedDescription,
        idempotencyKey: idempotencyKeyRef.current,
        name: normalizedName,
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
      <form className="w-full max-w-[720px] px-4 py-8 sm:px-10 sm:py-10" onSubmit={handleSubmit}>
        <div className="space-y-5">
          <label className="block">
            <span className="mb-2 block system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['newKnowledge.name'])}
            </span>
            <Input
              aria-invalid={nameError}
              maxLength={NAME_MAX_LENGTH}
              value={name}
              onValueChange={(value) => {
                setName(value)
                setNameError(false)
                resetRequestIdentity()
              }}
            />
            {nameError && (
              <span className="mt-1 block system-xs-regular text-text-destructive" role="alert">
                {t(($) => $['newKnowledge.nameRequired'])}
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-2 flex items-center gap-1 system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['newKnowledge.description'])}
              <span className="system-xs-regular normal-case">
                {tCommon(($) => $['label.optional'])}
              </span>
            </span>
            <Textarea
              aria-label={t(($) => $['newKnowledge.description'])}
              className="min-h-20 resize-none"
              maxLength={DESCRIPTION_MAX_LENGTH}
              value={description}
              onValueChange={(value) => {
                setDescription(value)
                resetRequestIdentity()
              }}
            />
            <span className="mt-1 block text-right system-xs-regular text-text-quaternary">
              {description.length}/{DESCRIPTION_MAX_LENGTH}
            </span>
          </label>
          <label className="block">
            <span className="mb-2 block system-xs-medium-uppercase text-text-tertiary">
              {t(($) => $['newKnowledge.permission'])}
            </span>
            <select
              aria-label={t(($) => $['newKnowledge.permission'])}
              className="h-9 w-full appearance-none rounded-lg border border-components-input-border-active bg-components-input-bg-normal px-3 system-sm-regular text-components-input-text-filled outline-hidden focus:ring-2 focus:ring-state-accent-solid"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as KnowledgeVisibility)}
            >
              <option value="only_me">{t(($) => $['newKnowledge.permissionOnlyMe'])}</option>
              <option value="all_members">
                {t(($) => $['newKnowledge.permissionAllMembers'])}
              </option>
            </select>
          </label>
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
            {tCommon(($) => $['operation.create'])}
          </Button>
        </div>
      </form>
    </main>
  )
}
