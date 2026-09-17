'use client'

import type { MessageTemplateTestRequest } from '@dify/contracts/api/console/apps/types.gen'
import type { HumanInputV2MessageTemplate } from '../types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { getInputVars } from '@/app/components/base/prompt-editor/constants'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useIsChatMode } from '@/app/components/workflow/hooks/use-workflow'
import { isENV } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import VarReferencePicker from '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker'
import { VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/client'
import { FlowType } from '@/types/common'
import MailBodyInput from '../../human-input/components/delivery-method/mail-body-input'
import { isOutput } from '../../human-input/utils'
import { HUMAN_INPUT_V2_DEBUG_CHANNELS } from '../types'

const getTemplateVariableType = (selector: ValueSelector, availableVars: NodeOutPutVar[]) => {
  const vars = availableVars.find((item) => item.nodeId === selector[0])?.vars
  const flattened = availableVars
    .flatMap((item) => item.vars)
    .find((item) => item.variable === selector.join('.'))
  if (flattened) return flattened.type
  let current: Var | undefined
  let children = vars
  for (const key of selector.slice(1)) {
    current = children?.find((item) => item.variable === key)
    children = Array.isArray(current?.children) ? current.children : undefined
  }
  return current?.type ?? VarType.string
}

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
  const [showTest, setShowTest] = useState(false)
  const [channel, setChannel] = useState<MessageTemplateTestRequest['channel']>('email')
  const [testInputs, setTestInputs] = useState<Record<string, string>>({})
  const [testError, setTestError] = useState<string>()
  const [savingForTest, setSavingForTest] = useState(false)
  const canRun = useHooksStore((state) => state.accessControl.canRun)
  const flowId = useHooksStore((state) => state.configsMap?.flowId)
  const flowType = useHooksStore((state) => state.configsMap?.flowType)
  const isChatMode = useIsChatMode()
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const testMutation = useMutation(
    (isChatMode
      ? consoleQuery.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId
          .messageTemplate.test.post
      : consoleQuery.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.messageTemplate.test
          .post
    ).mutationOptions({ retry: false }),
  )
  const canTest = !readonly && canRun && flowType === FlowType.appFlow && !!flowId && !!nodeId
  const pending = savingForTest || testMutation.isPending
  const pendingRef = useRef(false)
  const canTestRef = useRef(canTest)
  const testContext = `${flowId}:${nodeId}:${isChatMode}`
  const testContextRef = useRef(testContext)
  useEffect(() => {
    canTestRef.current = canTest
    testContextRef.current = testContext
    return () => {
      canTestRef.current = false
    }
  }, [canTest, testContext])
  const variables = Array.from(
    new Map(
      getInputVars(`${draft.subject}\n${draft.body}`)
        .filter((selector) => !isENV(selector) && !isOutput(selector))
        .map((selector) => [
          selector.join('.'),
          {
            key: `#${selector.join('.')}#`,
            label: selector.join('.'),
            type: getTemplateVariableType(selector, availableVars),
          },
        ]),
    ).values(),
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null)

  const restoreFocus = () =>
    requestAnimationFrame(() => (activeTriggerRef.current ?? triggerRef.current)?.focus())
  const close = () => {
    if (pendingRef.current) return
    setOpen(false)
    setDraft(value)
    setErrors({ subject: false, body: false })
    restoreFocus()
  }
  const handleOpen = (test = false, trigger = triggerRef.current) => {
    activeTriggerRef.current = trigger
    setDraft(value)
    setErrors({ subject: false, body: false })
    setShowTest(test)
    setChannel('email')
    setTestInputs({})
    setTestError(undefined)
    testMutation.reset()
    setOpen(true)
  }
  const validateTemplate = () => {
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
      return false
    }
    return true
  }
  const save = () => {
    if (submitted || readonly || pendingRef.current || !validateTemplate()) return
    setSubmitted(true)
    onChange({ subject: draft.subject, body: draft.body })
    setOpen(false)
    setSubmitted(false)
    restoreFocus()
  }
  const resetTestResult = () => {
    setTestError(undefined)
    testMutation.reset()
  }
  const sendTest = async () => {
    if (!canTest || !flowId || pendingRef.current || !validateTemplate()) return
    resetTestResult()
    const inputs: MessageTemplateTestRequest['inputs'] = {}
    for (const variable of variables) {
      const raw = testInputs[variable.key]
      if (!raw?.trim()) {
        setTestError(
          t(($) => $['nodes.humanInputV2.template.testInputsRequired'], { ns: 'workflow' }),
        )
        document.getElementById(`${nodeId}-test-${variable.key}`)?.focus()
        return
      }
      try {
        const value: unknown =
          variable.type === VarType.arrayString
            ? JSON.parse(raw)
            : variable.type === VarType.number
              ? Number(raw)
              : raw
        if (
          variable.type === VarType.arrayString &&
          (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
        )
          throw new Error('invalid-array')
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('invalid-number')
        inputs[variable.key] = value
      } catch {
        setTestError(
          variable.type === VarType.number
            ? t(($) => $['nodes.agent.outputVars.defaultValueNumberInvalid'], { ns: 'workflow' })
            : t(($) => $['errorMsg.invalidJson'], { ns: 'workflow', field: variable.label }),
        )
        document.getElementById(`${nodeId}-test-${variable.key}`)?.focus()
        return
      }
    }
    pendingRef.current = true
    setSavingForTest(true)
    try {
      onChange({ subject: draft.subject, body: draft.body })
      let saved = false
      let failed = false
      const result = await doSyncWorkflowDraft(true, {
        onSuccess: () => {
          saved = true
        },
        onError: () => {
          failed = true
        },
      })
      // The endpoint reads the saved node; a skipped or failed save must not test stale content.
      if (failed || (!saved && result == null)) throw new Error('draft-not-saved')
    } catch {
      setTestError(t(($) => $['nodes.humanInputV2.template.testSaveFailed'], { ns: 'workflow' }))
      pendingRef.current = false
      setSavingForTest(false)
      return
    }
    setSavingForTest(false)
    try {
      if (!canTestRef.current || testContextRef.current !== testContext) return
      await testMutation.mutateAsync({
        params: { app_id: flowId, node_id: nodeId },
        body: { channel, inputs },
      })
    } catch (error) {
      const unavailable =
        typeof error === 'object' && error !== null && 'status' in error && error.status === 501
      setTestError(
        t(
          ($) =>
            $[
              unavailable
                ? 'nodes.humanInputV2.template.testUnavailable'
                : 'nodes.humanInputV2.template.testFailed'
            ],
          { ns: 'workflow' },
        ),
      )
    } finally {
      pendingRef.current = false
    }
  }
  const insertSubjectVariable = (selector: ValueSelector) => {
    resetTestResult()
    setDraft((current) => ({
      ...current,
      subject: `${current.subject}{{#${selector.join('.')}#}}`,
    }))
  }

  return (
    <section className="px-4">
      <div className="flex h-9 w-full items-center gap-2 rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-on-panel-item-bg px-2 shadow-xs">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md border border-divider-regular bg-components-icon-bg-midnight-solid bg-linear-to-br from-components-avatar-bg-mask-stop-0 to-components-avatar-bg-mask-stop-100 text-text-primary-on-surface">
          <span className="i-ri-mail-send-fill size-3.5" aria-hidden />
        </span>
        <div className="flex min-w-0 grow items-center gap-1">
          <button
            ref={triggerRef}
            type="button"
            className="min-w-0 truncate rounded-sm border-0 bg-transparent p-0 text-left system-sm-medium text-text-secondary focus-visible:ring-1 focus-visible:ring-state-accent-solid"
            onClick={() => handleOpen()}
          >
            {t(($) => $['nodes.humanInputV2.template.title'], { ns: 'workflow' })}
          </button>
          <Infotip
            aria-label={t(($) => $['nodes.humanInputV2.template.description'], { ns: 'workflow' })}
          >
            {t(($) => $['nodes.humanInputV2.template.description'], { ns: 'workflow' })}
          </Infotip>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canTest && (
            <IconButton
              aria-label={t(($) => $['nodes.humanInputV2.template.test'], { ns: 'workflow' })}
              onClick={(event) => handleOpen(true, event.currentTarget)}
            >
              <span className="i-ri-send-plane-2-line size-4" aria-hidden />
            </IconButton>
          )}
          <IconButton
            aria-label={t(($) => $['common.configure'], { ns: 'workflow' })}
            onClick={(event) => handleOpen(false, event.currentTarget)}
          >
            <span className="i-ri-equalizer-2-line size-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close()
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)]! max-w-[720px]! overflow-hidden! border-0! p-0! inset-ring-[0.5px] inset-ring-components-panel-border">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              save()
            }}
          >
            <header className="relative flex h-[78px] items-start pt-6 pr-14 pb-3 pl-6">
              <div className="space-y-1">
                <DialogTitle className="text-[18px] leading-[1.2] font-semibold text-text-primary">
                  {t(($) => $['nodes.humanInputV2.template.title'], { ns: 'workflow' })}
                </DialogTitle>
                <p className="system-xs-regular text-text-tertiary">
                  {t(($) => $['nodes.humanInputV2.template.description'], { ns: 'workflow' })}
                </p>
              </div>
              <IconButton
                size="lg"
                className="absolute top-5 right-5"
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                disabled={pending}
                onClick={close}
              >
                <span className="i-ri-close-line size-4.5" aria-hidden />
              </IconButton>
            </header>
            <div className="max-h-[60vh] min-h-[260px] space-y-5 overflow-y-auto px-6 py-3">
              <div>
                <div className="mb-1 flex h-6 items-center justify-between">
                  <label
                    htmlFor={`${nodeId}-message-subject`}
                    className="system-sm-medium text-text-secondary"
                  >
                    {t(($) => $['nodes.humanInputV2.template.subject'], { ns: 'workflow' })}
                  </label>
                  {!readonly && (
                    <VarReferencePicker
                      nodeId={nodeId}
                      readonly={readonly || pending}
                      value={[]}
                      availableVars={availableVars}
                      availableNodes={availableNodes}
                      trigger={
                        <Button variant="ghost" size="small" disabled={pending}>
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
                  disabled={readonly || pending}
                  aria-invalid={errors.subject}
                  aria-describedby={errors.subject ? `${nodeId}-message-subject-error` : undefined}
                  onChange={(event) => {
                    resetTestResult()
                    setDraft((current) => ({ ...current, subject: event.target.value }))
                  }}
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
                  className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary"
                >
                  {t(($) => $['nodes.humanInputV2.template.body'], { ns: 'workflow' })}
                </div>
                <div className="[&>div>[contenteditable]]:min-h-[118px]">
                  <MailBodyInput
                    readOnly={readonly || pending}
                    value={draft.body}
                    nodesOutputVars={availableVars}
                    availableNodes={availableNodes}
                    onChange={(body) => {
                      resetTestResult()
                      setDraft((current) => ({ ...current, body }))
                    }}
                  />
                </div>
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
              {showTest && canTest && (
                <section
                  className="space-y-3 border-t border-divider-subtle pt-4"
                  aria-label={t(($) => $['nodes.humanInputV2.template.test'], { ns: 'workflow' })}
                >
                  <p className="system-xs-regular text-text-tertiary">
                    {t(($) => $['nodes.humanInputV2.template.testDescription'], { ns: 'workflow' })}
                  </p>
                  <div>
                    <Select<MessageTemplateTestRequest['channel']>
                      value={channel}
                      disabled={pending}
                      items={HUMAN_INPUT_V2_DEBUG_CHANNELS.map((value) => ({
                        value,
                        label: t(($) => $[`nodes.humanInputV2.debug.channel.${value}`], {
                          ns: 'workflow',
                        }),
                      }))}
                      onValueChange={(value) => {
                        if (value) {
                          setChannel(value)
                          resetTestResult()
                        }
                      }}
                    >
                      <SelectLabel className="mb-1 block system-xs-medium text-text-secondary">
                        {t(($) => $['nodes.humanInputV2.template.testChannel'], { ns: 'workflow' })}
                      </SelectLabel>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {HUMAN_INPUT_V2_DEBUG_CHANNELS.map((value) => (
                          <SelectItem key={value} value={value}>
                            <SelectItemText>
                              {t(($) => $[`nodes.humanInputV2.debug.channel.${value}`], {
                                ns: 'workflow',
                              })}
                            </SelectItemText>
                            <SelectItemIndicator />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {variables.map((variable) => (
                    <div key={variable.key}>
                      <label
                        htmlFor={`${nodeId}-test-${variable.key}`}
                        className="mb-1 block system-xs-medium break-all text-text-secondary"
                      >
                        {variable.label}
                      </label>
                      {variable.type === VarType.arrayString ? (
                        <Textarea
                          id={`${nodeId}-test-${variable.key}`}
                          value={testInputs[variable.key] ?? ''}
                          disabled={pending}
                          placeholder='["value"]'
                          onValueChange={(value) => {
                            setTestInputs((current) => ({ ...current, [variable.key]: value }))
                            resetTestResult()
                          }}
                        />
                      ) : (
                        <Input
                          id={`${nodeId}-test-${variable.key}`}
                          type={
                            variable.type === VarType.number
                              ? 'number'
                              : variable.type === VarType.secret
                                ? 'password'
                                : 'text'
                          }
                          step="any"
                          value={testInputs[variable.key] ?? ''}
                          disabled={pending}
                          onChange={(event) => {
                            setTestInputs((current) => ({
                              ...current,
                              [variable.key]: event.target.value,
                            }))
                            resetTestResult()
                          }}
                        />
                      )}
                    </div>
                  ))}
                  {testError && (
                    <p role="alert" className="system-xs-regular text-text-destructive">
                      {testError}
                    </p>
                  )}
                  {testMutation.isSuccess && (
                    <p role="status" className="system-xs-regular text-text-success">
                      {t(($) => $['nodes.humanInputV2.template.testCompleted'], { ns: 'workflow' })}
                    </p>
                  )}
                  <Button onClick={sendTest} loading={pending}>
                    {t(($) => $['nodes.humanInputV2.template.saveAndTest'], { ns: 'workflow' })}
                  </Button>
                </section>
              )}
            </div>
            <footer className="flex h-[76px] items-center justify-end gap-2 px-6 pt-5 pb-6">
              {canTest && (
                <Button
                  className="mr-auto"
                  disabled={pending}
                  aria-expanded={showTest}
                  onClick={() => setShowTest(!showTest)}
                >
                  <span className="i-ri-send-plane-2-line size-4" aria-hidden />
                  {t(($) => $['nodes.humanInputV2.template.test'], { ns: 'workflow' })}
                </Button>
              )}
              <Button className="min-w-18" onClick={close} disabled={pending}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              {!readonly && (
                <Button
                  className="min-w-18"
                  type="submit"
                  variant="primary"
                  disabled={submitted || pending}
                >
                  {t(($) => $['operation.save'], { ns: 'common' })}
                </Button>
              )}
            </footer>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

export default MessageTemplate
