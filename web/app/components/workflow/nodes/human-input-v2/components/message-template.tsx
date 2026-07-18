'use client'

import type { HumanInputV2MessageTemplate } from '../types'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import MailBodyInput from '../../human-input/components/delivery-method/mail-body-input'

type MessageTemplateProps = {
  nodeId: string
  value: HumanInputV2MessageTemplate
  onChange: (value: HumanInputV2MessageTemplate) => void
  readonly: boolean
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
}

const MessageTemplate = ({
  nodeId,
  value,
  onChange,
  readonly,
  availableVars,
  availableNodes,
}: MessageTemplateProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState({ subject: false, body: false })
  const triggerRef = useRef<HTMLButtonElement>(null)

  const restoreFocus = () => requestAnimationFrame(() => triggerRef.current?.focus())
  const close = () => {
    setOpen(false)
    setDraft(value)
    setErrors({ subject: false, body: false })
    restoreFocus()
  }
  const handleOpen = () => {
    setDraft(value)
    setErrors({ subject: false, body: false })
    setOpen(true)
  }
  const save = () => {
    if (submitted || readonly) return
    const nextErrors = { subject: !draft.subject.trim(), body: !draft.body.trim() }
    setErrors(nextErrors)
    if (nextErrors.subject || nextErrors.body) {
      requestAnimationFrame(() => {
        if (nextErrors.subject) {
          document.getElementById(`${nodeId}-message-subject`)?.focus()
          return
        }
        document
          .getElementById(`${nodeId}-message-body-label`)
          ?.parentElement?.querySelector<HTMLElement>('textarea, [contenteditable="true"]')
          ?.focus()
      })
      return
    }
    setSubmitted(true)
    onChange({ subject: draft.subject, body: draft.body })
    setOpen(false)
    setSubmitted(false)
    restoreFocus()
  }
  const insertSubjectVariable = (selector: ValueSelector) => {
    setDraft((current) => ({
      ...current,
      subject: `${current.subject}{{#${selector.join('.')}#}}`,
    }))
  }

  return (
    <section className="px-4 py-2">
      <button
        ref={triggerRef}
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-components-option-card-option-border bg-background-section px-2 text-left hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-state-accent-solid"
        onClick={handleOpen}
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-components-icon-bg-indigo-solid text-text-primary-on-surface">
          <span className="i-ri-mail-settings-line size-3.5" aria-hidden />
        </span>
        <span className="min-w-0 grow">
          <span className="block system-xs-medium text-text-secondary">
            {t(($) => $['nodes.humanInputV2.template.title'], { ns: 'workflow' })}
          </span>
          <span className="block truncate system-2xs-regular text-text-tertiary">
            {value.subject ||
              t(($) => $['nodes.humanInputV2.template.notConfigured'], { ns: 'workflow' })}
          </span>
        </span>
        <span className="i-ri-settings-3-line size-4 text-text-tertiary" aria-hidden />
      </button>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close()
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)]! max-w-[720px]! overflow-hidden! p-0!">
          <header className="flex h-[78px] items-center border-b border-divider-subtle px-6">
            <div>
              <DialogTitle className="system-xl-semibold text-text-primary">
                {t(($) => $['nodes.humanInputV2.template.title'], { ns: 'workflow' })}
              </DialogTitle>
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['nodes.humanInputV2.template.description'], { ns: 'workflow' })}
              </p>
            </div>
          </header>
          <div className="h-[260px] space-y-4 overflow-y-auto px-6 py-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label
                  htmlFor={`${nodeId}-message-subject`}
                  className="system-xs-medium text-text-secondary"
                >
                  {t(($) => $['nodes.humanInputV2.template.subject'], { ns: 'workflow' })}
                </label>
                {!readonly && (
                  <VarReferencePicker
                    nodeId={nodeId}
                    readonly={readonly}
                    value={[]}
                    availableVars={availableVars}
                    availableNodes={availableNodes}
                    trigger={
                      <Button variant="ghost" size="small">
                        {t(($) => $['nodes.humanInputV2.template.insertVariable'], {
                          ns: 'workflow',
                        })}
                      </Button>
                    }
                    onChange={(selector) => {
                      if (Array.isArray(selector)) insertSubjectVariable(selector)
                    }}
                  />
                )}
              </div>
              <Input
                id={`${nodeId}-message-subject`}
                value={draft.subject}
                disabled={readonly}
                aria-invalid={errors.subject}
                aria-describedby={errors.subject ? `${nodeId}-message-subject-error` : undefined}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, subject: event.target.value }))
                }
                placeholder={t(($) => $['nodes.humanInputV2.template.subjectPlaceholder'], {
                  ns: 'workflow',
                })}
              />
              {errors.subject && (
                <div
                  id={`${nodeId}-message-subject-error`}
                  role="alert"
                  className="mt-1 system-xs-regular text-text-destructive"
                >
                  {t(($) => $['nodes.humanInputV2.error.subjectRequired'], { ns: 'workflow' })}
                </div>
              )}
            </div>
            <div
              role="group"
              aria-labelledby={`${nodeId}-message-body-label`}
              aria-describedby={errors.body ? `${nodeId}-message-body-error` : undefined}
            >
              <div
                id={`${nodeId}-message-body-label`}
                className="mb-1 system-xs-medium text-text-secondary"
              >
                {t(($) => $['nodes.humanInputV2.template.body'], { ns: 'workflow' })}
              </div>
              <MailBodyInput
                readOnly={readonly}
                value={draft.body}
                nodesOutputVars={availableVars}
                availableNodes={availableNodes}
                onChange={(body) => setDraft((current) => ({ ...current, body }))}
              />
              {errors.body && (
                <div
                  id={`${nodeId}-message-body-error`}
                  role="alert"
                  className="mt-1 system-xs-regular text-text-destructive"
                >
                  {t(($) => $['nodes.humanInputV2.error.bodyRequired'], { ns: 'workflow' })}
                </div>
              )}
            </div>
          </div>
          <footer className="flex h-[76px] items-center justify-end gap-2 border-t border-divider-subtle px-6">
            <Button onClick={close}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
            {!readonly && (
              <Button variant="primary" disabled={submitted} onClick={save}>
                {t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
            )}
          </footer>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default MessageTemplate
