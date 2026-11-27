'use client'

import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { ReactNode } from 'react'
import type { PlanConfirmation } from './card-parts'
import type { Confirmation } from './confirmation'
import type { PlannedAction, RewriteRefusal, RewriteRequest } from './review'
import type { I18nKeysWithoutVariables } from '@/types/i18n'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { ORPCError } from '@orpc/client'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isRewriteText, REWRITE_MAX_LENGTH, rewriteRefusal } from './review'
import { useActionError, useAttempt } from './use-tidy'

type DialogActions = {
  /** Each resolves once the dialog may close and rejects with the cause to show in it. */
  onSave: (conflicts: boolean) => Promise<void>
  onRun: (plan: PlannedAction[]) => Promise<void>
  onAdopt: (request: RewriteRequest, text: string) => Promise<void>
}

type VariantProps = {
  onCancel: () => void
  pending: boolean
}

/** The page's one confirmation dialog; what it asks depends on the request. */
export function TidyDialog({
  finalFocus,
  onClose,
  open,
  opening,
  pending,
  request,
  ...actions
}: DialogActions & {
  finalFocus: DialogContentProps['finalFocus']
  onClose: () => void
  open: boolean
  opening: number
  pending: boolean
  request: Confirmation | undefined
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
    >
      <DialogContent finalFocus={finalFocus}>
        {request && (
          <ConfirmationVariant
            key={opening}
            request={request}
            pending={pending}
            onCancel={onClose}
            {...actions}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConfirmationVariant({
  onAdopt,
  onRun,
  onSave,
  request,
  ...shell
}: DialogActions & VariantProps & { request: Confirmation }) {
  switch (request.kind) {
    case 'enable':
      return <EnableConsent conflicts={request.conflicts} onSave={onSave} {...shell} />
    case 'conflicts':
      return <ConflictsConsent onSave={onSave} {...shell} />
    case 'plan':
      return <PlanConfirm confirmation={request} onRun={onRun} {...shell} />
    case 'rewrite':
      return <RewriteConfirm request={request} onAdopt={onAdopt} {...shell} />
  }
}

/** Title, description, optional body with the action's error, and the cancel/confirm pair. */
function ConfirmationForm({
  children,
  confirmDisabled,
  confirmLabel,
  description,
  error,
  onCancel,
  onSubmit,
  pending,
  title,
}: VariantProps & {
  children?: ReactNode
  confirmDisabled?: boolean
  confirmLabel?: string
  description: string
  error: string | undefined
  onSubmit: () => void
  title: string
}) {
  const { t: common } = useTranslation(['common'])
  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {(Boolean(children) || Boolean(error)) && (
        <DialogBody>
          {children}
          {error && (
            <p role="alert" className="text-text-destructive">
              {error}
            </p>
          )}
        </DialogBody>
      )}
      <DialogFooter>
        <Button type="button" disabled={pending} onClick={onCancel}>
          {common(($) => $['operation.cancel'])}
        </Button>
        <Button type="submit" variant="primary" loading={pending} disabled={confirmDisabled}>
          {confirmLabel ?? common(($) => $['operation.confirm'])}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Turning Tidy on: free on its own, billable once conflict detection is included. */
function EnableConsent({
  conflicts,
  onSave,
  ...shell
}: VariantProps & Pick<DialogActions, 'onSave'> & { conflicts: boolean }) {
  const { t } = useTranslation(['knowledgeSpace'])
  const [withConflicts, setWithConflicts] = useState(conflicts)
  const { attempt, error } = useAttempt(useActionError())
  return (
    <ConfirmationForm
      title={t(($) => $['tidy.name'])}
      description={withConflicts ? t(($) => $['tidy.tokenNotice']) : t(($) => $['tidy.freeNotice'])}
      error={error}
      onSubmit={() => void attempt(() => onSave(withConflicts))}
      {...shell}
    >
      <label className="flex items-start gap-2 body-sm-regular text-text-secondary">
        <Checkbox
          checked={withConflicts}
          onCheckedChange={(checked) => setWithConflicts(checked === true)}
        />
        {t(($) => $['tidy.consentConflicts'])}
      </label>
    </ConfirmationForm>
  )
}

/** Adding conflict detection to a space where Tidy already runs: the billable part alone. */
function ConflictsConsent({ onSave, ...shell }: VariantProps & Pick<DialogActions, 'onSave'>) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { attempt, error } = useAttempt(useActionError())
  return (
    <ConfirmationForm
      title={t(($) => $['tidy.conflicts'])}
      description={t(($) => $['tidy.tokenNotice'])}
      error={error}
      onSubmit={() => void attempt(() => onSave(true))}
      {...shell}
    />
  )
}

/** A plan that disables documents; the card that built it worded the question. */
function PlanConfirm({
  confirmation,
  onRun,
  ...shell
}: VariantProps & Pick<DialogActions, 'onRun'> & { confirmation: PlanConfirmation }) {
  const { attempt, error } = useAttempt(useActionError())
  return (
    <ConfirmationForm
      title={confirmation.title}
      description={confirmation.description}
      error={error}
      onSubmit={() => void attempt(() => onRun(confirmation.plan))}
      {...shell}
    />
  )
}

const REWRITE_REFUSAL_LABELS = {
  document_busy: 'tidy.rewriteBusy',
  not_indexed: 'tidy.rewriteNotFound',
  passage_not_found: 'tidy.rewriteNotFound',
  passage_ambiguous: 'tidy.rewriteAmbiguous',
  no_change: 'tidy.rewriteNoChange',
  too_long: 'tidy.rewriteTooLong',
  unsupported: 'tidy.rewriteUnavailable',
} as const satisfies Record<RewriteRefusal, I18nKeysWithoutVariables<'knowledgeSpace'>>

/** Adopting one side of a conflict: shows the passage that goes and lets the reviewer edit its replacement. */
function RewriteConfirm({
  onAdopt,
  request,
  ...shell
}: VariantProps & Pick<DialogActions, 'onAdopt'> & { request: RewriteRequest }) {
  const { t } = useTranslation(['knowledgeSpace'])
  const replacementId = useId()
  const [replacement, setReplacement] = useState(request.replacement)
  const describe = useActionError()
  const { attempt, error } = useAttempt((cause) => {
    const refusal = rewriteRefusal(cause instanceof ORPCError ? cause.data : undefined)
    return refusal ? t(($) => $[REWRITE_REFUSAL_LABELS[refusal]]) : describe(cause)
  })
  const sendable = isRewriteText(replacement)
  return (
    <ConfirmationForm
      title={t(($) => $['tidy.rewriteTitle'], { title: request.keptTitle })}
      description={t(($) => $['tidy.rewriteDescription'], { title: request.targetTitle })}
      error={error}
      confirmLabel={t(($) => $['tidy.rewriteConfirm'])}
      confirmDisabled={!sendable}
      onSubmit={() => {
        if (sendable) void attempt(() => onAdopt(request, replacement))
      }}
      {...shell}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="system-xs-medium text-text-tertiary">
            {t(($) => $['tidy.rewriteCurrent'])}
          </span>
          <blockquote className="max-h-32 overflow-y-auto rounded-lg bg-background-section px-3 py-2 body-sm-regular wrap-break-word whitespace-pre-wrap text-text-tertiary line-through">
            {request.passage}
          </blockquote>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={replacementId} className="system-xs-medium text-text-tertiary">
            {t(($) => $['tidy.rewriteReplacement'])}
          </label>
          <Textarea
            id={replacementId}
            value={replacement}
            rows={4}
            maxLength={REWRITE_MAX_LENGTH}
            onValueChange={setReplacement}
          />
        </div>
      </div>
    </ConfirmationForm>
  )
}
