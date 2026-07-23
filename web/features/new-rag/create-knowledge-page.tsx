'use client'

import type { KnowledgeSpaceCreationResponse } from '@dify/contracts/knowledge-fs/types.gen'
import type { CreateKnowledgeExitReason } from './components/create-knowledge-exit-dialog'
import type { KnowledgeVisibility } from './create-knowledge-workflow'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeIllustration, StartMode } from './components/create-knowledge-dialog-parts'
import { CreateKnowledgeExitDialog } from './components/create-knowledge-exit-dialog'
import {
  createKnowledge,
  DESCRIPTION_MAX_LENGTH,
  isDefinitiveCreationRejection,
  KnowledgeCreationError,
  NAME_MAX_LENGTH,
} from './create-knowledge-workflow'
import { newKnowledgeDetailPath } from './routes'

export function CreateKnowledgePage() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const queryClient = useQueryClient()
  const dialogTitleId = useId()
  const permissionDescriptionId = useId()
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canConfigureAccess = hasPermission(
    workspacePermissionKeys,
    DatasetACLPermission.AccessConfig,
  )
  const defaultVisibility: KnowledgeVisibility = canConfigureAccess ? 'all_members' : 'only_me'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<KnowledgeVisibility>(defaultVisibility)
  const [createdKnowledge, setCreatedKnowledge] = useState<KnowledgeSpaceCreationResponse>()
  const [submissionLocked, setSubmissionLocked] = useState(false)
  const [exitReason, setExitReason] = useState<CreateKnowledgeExitReason | null>(null)
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  const createMutation = useMutation({ mutationFn: createKnowledge })

  const resetUnsubmittedError = () => {
    if (!submissionLocked) createMutation.reset()
  }

  const requestClose = () => {
    if (createMutation.isPending) return
    if (createdKnowledge) {
      setExitReason('partial')
      return
    }
    if (name || description || visibility !== defaultVisibility) {
      setExitReason('discard')
      return
    }
    router.back()
  }

  const confirmExit = () => {
    const confirmedReason = exitReason
    setExitReason(null)
    if (confirmedReason === 'partial' && createdKnowledge) {
      router.replace(newKnowledgeDetailPath(createdKnowledge.id))
      return
    }
    router.back()
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
        onCreated: (knowledgeSpace) => {
          setCreatedKnowledge(knowledgeSpace)
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.listKnowledgeSpaces.key(),
          })
        },
        visibility,
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
          <button
            type="button"
            aria-label={tCommon(($) => $['operation.close'])}
            className="absolute top-3 right-3 z-10 flex size-9 items-center justify-center rounded-xl bg-background-section-burn text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
            onClick={requestClose}
            disabled={createMutation.isPending}
          >
            <span aria-hidden className="i-ri-close-line size-5" />
          </button>

          <div className="flex min-h-0 min-w-0 flex-col items-end border-divider-subtle xl:border-r">
            <div className="min-h-6 w-full max-w-[760px] flex-1 [@media(max-height:850px)]:h-6 [@media(max-height:850px)]:flex-none" />
            <Form
              className="flex w-full max-w-[760px] shrink-0 flex-col [@media(max-height:850px)]:min-h-0 [@media(max-height:850px)]:flex-1"
              onFormSubmit={handleSubmit}
            >
              <header className="shrink-0 px-6 pt-2 pb-6 sm:px-10">
                <DialogTitle id={dialogTitleId} className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['newKnowledge.createTitle'])}
                </DialogTitle>
              </header>

              <div className="flex min-h-0 flex-col gap-4 px-6 sm:px-10 [@media(max-height:850px)]:flex-1 [@media(max-height:850px)]:overflow-y-auto">
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

                <fieldset>
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
                    disabled={createMutation.isPending}
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
                    {t(($) =>
                      createMutation.error instanceof KnowledgeCreationError &&
                      createMutation.error.stage === 'policy'
                        ? $['newKnowledge.permissionUpdateFailed']
                        : $['newKnowledge.createFailed'],
                    )}
                  </div>
                )}
              </div>

              <div className="shrink-0 px-6 pt-5 pb-10 sm:px-10">
                <div className="flex justify-end gap-2">
                  <Button type="button" disabled={createMutation.isPending} onClick={requestClose}>
                    {tCommon(($) => $['operation.cancel'])}
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={!name.trim()}
                    loading={createMutation.isPending}
                  >
                    {t(($) => $['newKnowledge.createTitle'])}
                  </Button>
                </div>
              </div>
            </Form>
            <div className="min-h-px w-full max-w-[760px] flex-1 [@media(max-height:850px)]:h-6 [@media(max-height:850px)]:flex-none" />
          </div>

          <aside className="hidden min-h-0 min-w-0 xl:block">
            <KnowledgeIllustration title={t(($) => $['newKnowledge.illustrationHeadline'])} />
          </aside>
        </DialogPopup>
      </DialogPortal>
      <CreateKnowledgeExitDialog
        reason={exitReason}
        onCancel={() => setExitReason(null)}
        onConfirm={confirmExit}
      />
    </Dialog>
  )
}
