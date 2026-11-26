'use client'

import type {
  KnowledgeAgentGrantResponse,
  KnowledgeAgentTokenCreatedResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { KnowledgeBaseOption } from './knowledge-base-options'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import {
  NumberField,
  NumberFieldControls,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from '@langgenius/dify-ui/number-field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useMutation } from '@tanstack/react-query'
import { useClipboard } from 'foxact/use-clipboard'
import { useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { consoleQuery } from '@/service/console'
import {
  DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS,
  MAX_PERSONAL_TOKEN_EXPIRY_DAYS,
  PERSONAL_TOKEN_EXPIRY_OPTIONS,
} from './agent-access'
import { AgentIcon } from './agent-icon'
import { AGENT_TOKEN_ENV, AGENTS } from './agents'
import { grantName, useGrantError, useInvalidateAgentAccess } from './grants'
import { KnowledgeBasePicker } from './knowledge-base-picker'

export type PickerProps = {
  blocked: ReadonlySet<string>
  /** Every page of the member's knowledge bases is loaded: an id not among them is gone. */
  complete: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  options: KnowledgeBaseOption[]
}

const LABEL_CLASS_NAME = 'system-xs-medium text-text-primary'
const HINT_CLASS_NAME = 'system-xs-regular text-text-tertiary'
const NOTICE_CLASS_NAME =
  'rounded-lg bg-state-warning-hover px-3 py-2 body-xs-regular text-text-warning'

/** A personal token shows its last characters; an authorized agent has none to show. */
export function GrantIdentity({ grant }: { grant: KnowledgeAgentGrantResponse }) {
  const { t } = useTranslation(['knowledgeSpace'])
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AgentIcon name={grantName(grant)} personal={grant.kind === 'personal'} />
      <span className="truncate system-sm-medium text-text-primary">{grantName(grant)}</span>
      <span className="shrink-0 text-[11px]/4 text-text-tertiary" translate="no">
        {grant.kind === 'personal'
          ? grant.token_hint && `•••• ${grant.token_hint}`
          : t(($) => $['agents.kindOAuth'])}
      </span>
    </span>
  )
}

function KnowledgeBaseAccessField({
  disabled,
  knowledgeBases,
  onChange,
  value,
}: {
  disabled: boolean
  knowledgeBases: PickerProps
  onChange: (value: string[]) => void
  value: string[]
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  return (
    <div className="flex flex-col gap-1.5">
      <span className={LABEL_CLASS_NAME}>{t(($) => $['agents.knowledgeBaseAccess'])}</span>
      <span className={HINT_CLASS_NAME}>{t(($) => $['agents.knowledgeBaseAccessHint'])}</span>
      <KnowledgeBasePicker
        blocked={knowledgeBases.blocked}
        hasMore={knowledgeBases.hasMore}
        loadingMore={knowledgeBases.loadingMore}
        onLoadMore={knowledgeBases.onLoadMore}
        options={knowledgeBases.options}
        disabled={disabled}
        value={value}
        onChange={onChange}
      />
    </div>
  )
}

type ExpiryChoice = `${number}` | 'never' | 'custom'

const expiryChoice = (option: (typeof PERSONAL_TOKEN_EXPIRY_OPTIONS)[number]): ExpiryChoice =>
  option === null ? 'never' : option === 'custom' ? 'custom' : `${option}`

export function CreateTokenDialog({
  knowledgeBases,
  onCreated,
  onOpenChange,
  open,
}: {
  knowledgeBases: PickerProps
  onCreated: (result: KnowledgeAgentTokenCreatedResponse) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted with the dialog, so every opening starts from an empty form. */}
        {open && (
          <CreateTokenForm
            knowledgeBases={knowledgeBases}
            onCancel={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateTokenForm({
  knowledgeBases,
  onCancel,
  onCreated,
}: {
  knowledgeBases: PickerProps
  onCancel: () => void
  onCreated: (result: KnowledgeAgentTokenCreatedResponse) => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const grantError = useGrantError()
  const invalidate = useInvalidateAgentAccess()
  const expiryLabelId = useId()
  const customDaysId = useId()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [choice, setChoice] = useState<ExpiryChoice>(`${DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS}`)
  const [customDays, setCustomDays] = useState<number | null>(DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS)
  const create = useMutation(
    consoleQuery.knowledgeFs.agentAccess.tokens.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: async (result) => {
        onCreated(result)
        await invalidate()
      },
    }),
  )
  // `null` is a token that never expires, and also a custom lifetime with no number entered
  // yet; `canSubmit` tells the two apart so an empty custom field is never sent as "never".
  const days = choice === 'never' ? null : choice === 'custom' ? customDays : Number(choice)
  const validDays =
    days === null || (Number.isInteger(days) && days >= 1 && days <= MAX_PERSONAL_TOKEN_EXPIRY_DAYS)
  const canSubmit =
    name.trim().length > 0 && selected.length > 0 && (choice !== 'custom' || customDays !== null)
  const choiceLabel = (value: ExpiryChoice) =>
    value === 'never'
      ? t(($) => $['agents.never'])
      : value === 'custom'
        ? t(($) => $['agents.custom'])
        : t(($) => $['agents.days'], { count: Number(value) })

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (create.isPending || !canSubmit || !validDays) return
        create.mutate({
          body: { name: name.trim(), knowledge_base_ids: selected, expires_in_days: days },
        })
      }}
    >
      <DialogHeader>
        <DialogTitle>{t(($) => $['agents.createTokenTitle'])}</DialogTitle>
        <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
      </DialogHeader>
      <DialogBody className="flex flex-col gap-6">
        <Field name="agent-token-name" className="flex flex-col gap-1.5">
          <FieldLabel className={LABEL_CLASS_NAME}>
            {t(($) => $['agents.tokenName'])}
            <span aria-hidden className="ms-0.5 text-text-destructive-secondary">
              *
            </span>
          </FieldLabel>
          <div className="relative">
            <Input
              required
              autoComplete="off"
              className="pe-8"
              maxLength={100}
              placeholder={t(($) => $['agents.tokenNamePlaceholder'])}
              value={name}
              onValueChange={setName}
            />
            {name && (
              <IconButton
                type="button"
                variant="ghost"
                size="md"
                className="absolute inset-e-1 top-1/2 -translate-y-1/2"
                aria-label={tCommon(($) => $['operation.clear'])}
                onClick={() => setName('')}
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            )}
          </div>
        </Field>
        <KnowledgeBaseAccessField
          disabled={create.isPending}
          knowledgeBases={knowledgeBases}
          value={selected}
          onChange={setSelected}
        />
        <div className="flex flex-col gap-1.5">
          <span id={expiryLabelId} className={LABEL_CLASS_NAME}>
            {t(($) => $['agents.tokenExpiry'])}
          </span>
          <span className={HINT_CLASS_NAME} aria-live="polite">
            {days === null
              ? choice === 'never'
                ? t(($) => $['agents.neverExpires'])
                : ' '
              : t(($) => $['agents.expiresInDays'], { count: days })}
          </span>
          <Select
            value={choice}
            onValueChange={(value) => value && setChoice(value as ExpiryChoice)}
          >
            <SelectTrigger aria-labelledby={expiryLabelId}>{choiceLabel(choice)}</SelectTrigger>
            <SelectContent>
              {PERSONAL_TOKEN_EXPIRY_OPTIONS.map((option) => {
                const value = expiryChoice(option)
                return (
                  <SelectItem key={value} value={value}>
                    <SelectItemText>{choiceLabel(value)}</SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {choice === 'custom' && (
            <div className="flex flex-col gap-1.5 pt-2">
              <label htmlFor={customDaysId} className={LABEL_CLASS_NAME}>
                {t(($) => $['agents.customDays'])}
              </label>
              <NumberField
                id={customDaysId}
                min={1}
                max={MAX_PERSONAL_TOKEN_EXPIRY_DAYS}
                step={1}
                value={customDays}
                onValueChange={setCustomDays}
              >
                <NumberFieldGroup>
                  <NumberFieldInput autoComplete="off" />
                  <NumberFieldControls>
                    <NumberFieldIncrement />
                    <NumberFieldDecrement />
                  </NumberFieldControls>
                </NumberFieldGroup>
              </NumberField>
            </div>
          )}
        </div>
        {create.isError && (
          <p role="alert" className="body-xs-regular text-text-destructive">
            {grantError(create.error, knowledgeBases.options)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" disabled={create.isPending} onClick={onCancel}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!canSubmit || !validDays}
        >
          {t(($) => $['agents.create'])}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CodeBlock({ code, file, title }: { code: string; file: string; title: string }) {
  const lineNumbers = code
    .split('\n')
    .map((_, index) => String(index + 1).padStart(2, '0'))
    .join('\n')
  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-[10px] bg-components-input-bg-normal">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-divider-subtle ps-2 pe-1">
        <span className="flex min-w-0 items-center gap-2">
          <AgentIcon name={title} />
          <span className="shrink-0 system-sm-medium text-text-primary">{title}</span>
          <code
            className="truncate font-mono text-xs text-text-tertiary"
            title={file}
            translate="no"
          >
            {file}
          </code>
        </span>
        <CopyFeedback content={code} />
      </div>
      <div className="flex max-h-40 gap-3 overflow-auto py-2 ps-4 pe-3 font-mono text-xs/[19.5px]">
        <span aria-hidden className="shrink-0 whitespace-pre text-text-tertiary select-none">
          {lineNumbers}
        </span>
        <pre className="text-text-primary" translate="no">
          {code}
        </pre>
      </div>
    </div>
  )
}

/** The only time the token is shown. It cannot be dismissed by clicking away. */
export function TokenCreatedDialog({
  mcpUrl,
  onDone,
  result,
}: {
  mcpUrl: string
  onDone: () => void
  result: KnowledgeAgentTokenCreatedResponse | null
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const { copied, copy } = useClipboard({ timeout: 2000 })
  return (
    <Dialog
      open={result !== null}
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!next) onDone()
      }}
    >
      <DialogContent className="w-150">
        <DialogHeader>
          <DialogTitle>{t(($) => $['agents.tokenCreatedTitle'])}</DialogTitle>
          <DialogDescription>{t(($) => $['agents.tokenCreated'])}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <div className="flex h-8 items-center justify-between gap-2 rounded-lg bg-components-input-bg-normal ps-3 pe-1.5">
            <code
              className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary"
              translate="no"
              aria-label={t(($) => $['agents.token'])}
            >
              {result?.token}
            </code>
            {copied ? (
              <span
                role="status"
                className="flex shrink-0 items-center gap-1 pe-1.5 system-xs-medium text-text-success"
              >
                <span aria-hidden className="i-ri-check-line size-4" />
                {tCommon(($) => $['operation.copied'])}
              </span>
            ) : (
              <IconButton
                variant="ghost"
                size="md"
                aria-label={tCommon(($) => $['operation.copy'])}
                onClick={() => result && copy(result.token)}
              >
                <span aria-hidden className="i-ri-file-copy-line size-4" />
              </IconButton>
            )}
          </div>
          <div className="flex flex-col gap-2.5">
            <p className="system-xs-regular text-text-tertiary">
              <Trans
                i18nKey={($) => $['agents.tokenUsage']}
                ns="knowledgeSpace"
                values={{ name: AGENT_TOKEN_ENV }}
                components={{
                  name: <code className="font-mono text-text-primary" translate="no" />,
                }}
              />
            </p>
            {AGENTS.map(({ id, name, tokenConfig }) => (
              <CodeBlock
                key={id}
                title={name}
                file={tokenConfig.file}
                code={tokenConfig.build(mcpUrl)}
              />
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="primary" onClick={onDone}>
            {t(($) => $['agents.done'])}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function EditGrantDialog({
  grant,
  knowledgeBases,
  onClose,
}: {
  grant: KnowledgeAgentGrantResponse | null
  knowledgeBases: PickerProps
  onClose: () => void
}) {
  return (
    <Dialog
      open={grant !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        {grant && (
          <EditGrantForm
            key={grant.id}
            grant={grant}
            knowledgeBases={knowledgeBases}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditGrantForm({
  grant,
  knowledgeBases,
  onClose,
}: {
  grant: KnowledgeAgentGrantResponse
  knowledgeBases: PickerProps
  onClose: () => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const grantError = useGrantError()
  const invalidate = useInvalidateAgentAccess()
  const [chosen, setChosen] = useState<string[]>(() => grant.knowledge_base_ids)
  // A connection can outlive what it was granted: a base may since have turned personal agents
  // off, or left the member's reach. The server refuses a save that still names one, and the
  // picker has no row (or only a disabled one) to untick it, so those ids are left out here.
  const { blocked, complete, options } = knowledgeBases
  const turnedOff = grant.knowledge_base_ids.filter((id) => blocked.has(id))
  const unavailable = complete
    ? grant.knowledge_base_ids.filter(
        (id) => !blocked.has(id) && !options.some((option) => option.id === id),
      )
    : []
  const selected = chosen.filter((id) => !blocked.has(id) && !unavailable.includes(id))
  const save = useMutation(
    consoleQuery.knowledgeFs.agentAccess.grants.byGrantId.patch.mutationOptions({
      meta: { errorToast: false },
      onSuccess: async () => {
        onClose()
        await invalidate()
      },
    }),
  )
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {grant.kind === 'personal'
            ? t(($) => $['agents.editTokenTitle'])
            : t(($) => $['agents.editConnectionTitle'])}
        </DialogTitle>
        <DialogDescription render={<div />}>
          <GrantIdentity grant={grant} />
        </DialogDescription>
        <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <KnowledgeBaseAccessField
          disabled={save.isPending}
          knowledgeBases={knowledgeBases}
          value={selected}
          onChange={setChosen}
        />
        {turnedOff.length > 0 && (
          <p role="status" className={NOTICE_CLASS_NAME}>
            {t(($) => $['agents.errorBlocked'], {
              names: turnedOff
                .map((id) => options.find((option) => option.id === id)?.name ?? id)
                .join(', '),
            })}
          </p>
        )}
        {unavailable.length > 0 && (
          <p role="status" className={NOTICE_CLASS_NAME}>
            {t(($) => $['agents.errorKnowledgeBases'], { names: unavailable.join(', ') })}
          </p>
        )}
        {save.isError && (
          <p role="alert" className="body-xs-regular text-text-destructive">
            {grantError(save.error, knowledgeBases.options)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button disabled={save.isPending} onClick={onClose}>
          {tCommon(($) => $['operation.cancel'])}
        </Button>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={selected.length === 0}
          onClick={() =>
            save.mutate({
              params: { grant_id: grant.id },
              body: { knowledge_base_ids: selected },
            })
          }
        >
          {t(($) => $['agents.saveChanges'])}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Deleting a personal token or disconnecting an authorized agent, one's own or a member's. */
export function RevokeGrantDialog({
  grant,
  onClose,
}: {
  grant: KnowledgeAgentGrantResponse | null
  onClose: () => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const invalidate = useInvalidateAgentAccess()
  const revoke = useMutation(
    consoleQuery.knowledgeFs.agentAccess.grants.byGrantId.delete.mutationOptions({
      meta: { errorToast: false },
      onSuccess: async () => {
        onClose()
        await invalidate()
      },
    }),
  )
  const personal = grant?.kind === 'personal'
  const member = grant?.account ? grant.account.name || grant.account.email : null
  return (
    <AlertDialog
      open={grant !== null}
      onOpenChange={(next) => {
        if (!next && !revoke.isPending) {
          onClose()
          revoke.reset()
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {personal
              ? t(($) => $['agents.deleteTokenTitle'])
              : t(($) => $['agents.disconnectTitle'], { name: grant ? grantName(grant) : '' })}
          </AlertDialogTitle>
          {grant && personal && <GrantIdentity grant={grant} />}
          <AlertDialogDescription>
            {member
              ? t(($) => $['agents.disconnectMemberDescription'], { member })
              : personal
                ? t(($) => $['agents.deleteTokenDescription'])
                : t(($) => $['agents.disconnectDescription'])}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {revoke.isError && (
          <p role="alert" className="px-6 body-xs-regular text-text-destructive">
            {t(($) => $['agents.errorGeneric'])}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancelButton disabled={revoke.isPending}>
            {tCommon(($) => $['operation.cancel'])}
          </AlertDialogCancelButton>
          <AlertDialogConfirmButton
            loading={revoke.isPending}
            onClick={() => grant && revoke.mutate({ params: { grant_id: grant.id } })}
          >
            {personal ? t(($) => $['agents.deleteToken']) : t(($) => $['agents.disconnect'])}
          </AlertDialogConfirmButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
