'use client'

import type { MessageTemplateTestRequest } from '@dify/contracts/api/console/apps/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { MutationKey } from '@tanstack/react-query'
import type { HumanInputV2MessageTemplate } from '../types'
import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Infotip, InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getInputVars } from '@/app/components/base/prompt-editor/constants'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { isENV } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { VarType } from '@/app/components/workflow/types'
import { consoleClient } from '@/service/console'
import { syncHumanInputDraft } from '../../human-input/shared/sync-draft'
import { isOutput } from '../../human-input/utils'
import { getRequestURLCount } from '../message-template-utils'
import useConfiguredChannels from '../use-configured-channels'
import MessageTemplateBody from './message-template-body'

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

const MessageTemplateSession = ({
  nodeId,
  value,
  onChange,
  readonly,
  availableVars,
  availableNodes,
  initialShowTest,
  close,
  mutationKey,
}: MessageTemplateProps & {
  initialShowTest: boolean
  close: () => void
  mutationKey: MutationKey
}) => {
  const { t } = useTranslation(['workflow', 'common', 'workflowAgent', 'contacts'])
  const [draft, setDraft] = useState(value)
  const [errors, setErrors] = useState({ subject: false, body: false })
  const [showTest, setShowTest] = useState(initialShowTest)
  const [channel, setChannel] = useState<MessageTemplateTestRequest['channel']>()
  const configured = useConfiguredChannels()
  const selectedChannel =
    channel && configured.channels.includes(channel) ? channel : configured.channels[0]
  const [testInputs, setTestInputs] = useState<Record<string, string>>({})
  const [testInputError, setTestInputError] = useState<{ key: string; message: string }>()
  const canRun = useHooksStore((state) => state.accessControl.canRun)
  const resource = useAtomValue(editorResourceAtom)
  const flowId = resource.kind === 'app' ? resource.appId : undefined
  const isChatMode = resource.kind === 'app' && resource.mode === 'advanced-chat'
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const canTest = !readonly && canRun && resource.kind === 'app' && !!flowId && !!nodeId
  const canTestRef = useRef(canTest)
  const testContext = `${flowId}:${nodeId}:${isChatMode}:${selectedChannel}`
  const testContextRef = useRef(testContext)
  useEffect(() => {
    canTestRef.current = canTest
    testContextRef.current = testContext
    return () => {
      canTestRef.current = false
    }
  }, [canTest, testContext])
  const testMutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: async ({
      inputs,
      channel,
      template,
      context,
    }: {
      inputs: MessageTemplateTestRequest['inputs']
      channel: MessageTemplateTestRequest['channel']
      template: HumanInputV2MessageTemplate
      context: string
    }) => {
      if (!flowId || !canTestRef.current) return false
      onChange({ subject: template.subject, body: template.body })
      try {
        await syncHumanInputDraft(doSyncWorkflowDraft)
      } catch {
        throw new Error('template-draft-not-saved')
      }
      if (!canTestRef.current || testContextRef.current !== context) return false
      const operation = isChatMode
        ? consoleClient.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId
            .messageTemplate.test.post
        : consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.messageTemplate.test
            .post
      await operation(
        { params: { app_id: flowId, node_id: nodeId }, body: { channel, inputs } },
        { context: { silent: true } },
      )
      return true
    },
  })
  const pending = testMutation.isPending
  const mutationError = testMutation.error
    ? t(
        ($) =>
          $[
            testMutation.error instanceof Error &&
            testMutation.error.message === 'template-draft-not-saved'
              ? 'nodes.humanInputV2.template.testSaveFailed'
              : typeof testMutation.error === 'object' &&
                  'status' in testMutation.error &&
                  testMutation.error.status === 501
                ? 'nodes.humanInputV2.template.testUnavailable'
                : 'nodes.humanInputV2.template.testFailed'
          ],
        { ns: 'workflow' },
      )
    : undefined

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
  const getBodyError = (body: string) => {
    if (!body.trim())
      return t(($) => $['nodes.humanInputV2.error.bodyRequired'], { ns: 'workflow' })
    const count = getRequestURLCount(body)
    if (!count)
      return t(($) => $['nodes.humanInputV2.error.requestURLRequired'], { ns: 'workflow' })
    if (count > 1)
      return t(($) => $['nodes.humanInputV2.error.requestURLDuplicate'], { ns: 'workflow' })
  }
  const validateTemplate = () => {
    const errors = { subject: !draft.subject.trim(), body: !!getBodyError(draft.body) }
    setErrors(errors)
    if (!errors.subject && !errors.body) return true
    requestAnimationFrame(() => {
      if (errors.subject) document.getElementById(`${nodeId}-message-subject`)?.focus()
      else
        document
          .getElementById(`${nodeId}-message-body`)
          ?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
          ?.focus()
    })
    return false
  }
  const save = () => {
    if (readonly || pending || !validateTemplate()) return
    onChange({ subject: draft.subject, body: draft.body })
    close()
  }
  const resetTestResult = () => {
    setTestInputError(undefined)
    testMutation.reset()
  }
  const sendTest = () => {
    if (!canTest || !flowId || !selectedChannel || pending || !validateTemplate()) return
    resetTestResult()
    const inputs: MessageTemplateTestRequest['inputs'] = {}
    for (const variable of variables) {
      const raw = testInputs[variable.key]
      if (!raw?.trim()) {
        setTestInputError({
          key: variable.key,
          message: t(($) => $['nodes.humanInputV2.template.testInputsRequired'], {
            ns: 'workflow',
          }),
        })
        requestAnimationFrame(() =>
          document.getElementById(`${nodeId}-test-${variable.key}`)?.focus(),
        )
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
        setTestInputError({
          key: variable.key,
          message:
            variable.type === VarType.number
              ? t(($) => $['nodes.agent.outputVars.defaultValueNumberInvalid'], {
                  ns: 'workflowAgent',
                })
              : t(($) => $['errorMsg.invalidJson'], { ns: 'workflow', field: variable.label }),
        })
        requestAnimationFrame(() =>
          document.getElementById(`${nodeId}-test-${variable.key}`)?.focus(),
        )
        return
      }
    }
    testMutation.mutate({ inputs, channel: selectedChannel, template: draft, context: testContext })
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['nodes.humanInputV2.template.title'], { ns: 'workflow' })}
        </DialogTitle>
        <DialogDescription>
          {t(($) => $['nodes.humanInputV2.template.description'], { ns: 'workflow' })}
        </DialogDescription>
        <DialogHeaderCloseButton
          disabled={pending}
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
        />
      </DialogHeader>
      <DialogBody className="min-h-65 space-y-5">
        <Field name="subject" invalid={errors.subject && !draft.subject.trim()}>
          <FieldLabel
            htmlFor={`${nodeId}-message-subject`}
            className="mb-1 flex h-6 items-center system-sm-medium text-text-secondary"
          >
            {t(($) => $['nodes.humanInputV2.template.subject'], { ns: 'workflow' })}
          </FieldLabel>
          <Input
            id={`${nodeId}-message-subject`}
            value={draft.subject}
            disabled={readonly || pending}
            aria-invalid={errors.subject && !draft.subject.trim()}
            aria-describedby={
              errors.subject && !draft.subject.trim()
                ? `${nodeId}-message-subject-error`
                : undefined
            }
            onChange={(event) => {
              resetTestResult()
              setDraft((current) => ({ ...current, subject: event.target.value }))
            }}
            placeholder={t(($) => $['nodes.humanInputV2.template.subjectPlaceholder'], {
              ns: 'workflow',
            })}
          />
          {errors.subject && !draft.subject.trim() && (
            <FieldError
              match
              id={`${nodeId}-message-subject-error`}
              className="mt-1 system-xs-regular text-text-destructive"
            >
              {t(($) => $['nodes.humanInputV2.error.subjectRequired'], { ns: 'workflow' })}
            </FieldError>
          )}
        </Field>
        <MessageTemplateBody
          nodeId={nodeId}
          readOnly={readonly || pending}
          value={draft.body}
          nodesOutputVars={availableVars}
          availableNodes={availableNodes}
          error={errors.body ? getBodyError(draft.body) : undefined}
          onChange={(body) => {
            resetTestResult()
            setDraft((current) => ({ ...current, body }))
          }}
        />
        {showTest && canTest && (
          <div
            className="space-y-3 border-t border-divider-subtle pt-4"
            aria-label={t(($) => $['nodes.humanInputV2.template.test'], { ns: 'workflow' })}
          >
            <p className="system-xs-regular text-text-tertiary">
              {t(($) => $['nodes.humanInputV2.template.testDescription'], { ns: 'workflow' })}
            </p>
            <div>
              <Select<MessageTemplateTestRequest['channel']>
                value={selectedChannel ?? null}
                disabled={pending || !configured.channels.length}
                items={configured.channels.map((value) => ({
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
                  <SelectValue
                    placeholder={t(($) => $['nodes.humanInputV2.template.notConfigured'], {
                      ns: 'workflow',
                    })}
                  />
                </SelectTrigger>
                <SelectContent>
                  {configured.channels.map((value) => (
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
              {configured.isPending && (
                <p role="status" className="mt-1 system-xs-regular text-text-tertiary">
                  {t(($) => $['imPlatform.loading'], { ns: 'contacts' })}
                </p>
              )}
              {configured.isError && (
                <div role="alert" className="mt-1 system-xs-regular text-text-destructive">
                  {t(($) => $['imPlatform.loadError.title'], { ns: 'contacts' })}
                  <Button size="small" onClick={() => void configured.refetch()}>
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                </div>
              )}
            </div>
            {variables.map((variable) => (
              <Field
                key={variable.key}
                name={variable.key}
                invalid={testInputError?.key === variable.key}
              >
                <FieldLabel
                  htmlFor={`${nodeId}-test-${variable.key}`}
                  className="mb-1 block system-xs-medium break-all text-text-secondary"
                >
                  {variable.label}
                </FieldLabel>
                {variable.type === VarType.arrayString ? (
                  <Textarea
                    id={`${nodeId}-test-${variable.key}`}
                    value={testInputs[variable.key] ?? ''}
                    disabled={pending}
                    aria-invalid={testInputError?.key === variable.key}
                    aria-describedby={
                      testInputError?.key === variable.key
                        ? `${nodeId}-test-${variable.key}-error`
                        : undefined
                    }
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
                    autoComplete={variable.type === VarType.secret ? 'new-password' : 'off'}
                    aria-invalid={testInputError?.key === variable.key}
                    aria-describedby={
                      testInputError?.key === variable.key
                        ? `${nodeId}-test-${variable.key}-error`
                        : undefined
                    }
                    onChange={(event) => {
                      setTestInputs((current) => ({
                        ...current,
                        [variable.key]: event.target.value,
                      }))
                      resetTestResult()
                    }}
                  />
                )}
                {testInputError?.key === variable.key && (
                  <FieldError match id={`${nodeId}-test-${variable.key}-error`}>
                    {testInputError.message}
                  </FieldError>
                )}
              </Field>
            ))}
            {mutationError && (
              <p role="alert" className="system-xs-regular text-text-destructive">
                {mutationError}
              </p>
            )}
            {testMutation.isSuccess && testMutation.data && (
              <p role="status" className="system-xs-regular text-text-success">
                {t(($) => $['nodes.humanInputV2.template.testCompleted'], { ns: 'workflow' })}
              </p>
            )}
            <Button onClick={sendTest} loading={pending} disabled={!selectedChannel}>
              {t(($) => $['nodes.humanInputV2.template.saveAndTest'], { ns: 'workflow' })}
            </Button>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        {canTest && (
          <Button
            className="me-auto"
            disabled={pending}
            aria-expanded={showTest}
            onClick={() => setShowTest(!showTest)}
          >
            <span className="i-ri-send-plane-2-line size-4" aria-hidden />
            {t(($) => $['nodes.humanInputV2.template.test'], { ns: 'workflow' })}
          </Button>
        )}
        <DialogClose render={<Button className="min-w-18" disabled={pending} />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        {!readonly && (
          <Button className="min-w-18" type="submit" variant="primary" disabled={pending}>
            {t(($) => $['operation.save'], { ns: 'common' })}
          </Button>
        )}
      </DialogFooter>
    </form>
  )
}

const MessageTemplate = (props: MessageTemplateProps) => {
  const { t } = useTranslation(['workflow', 'common'])
  const canRun = useHooksStore((state) => state.accessControl.canRun)
  const resource = useAtomValue(editorResourceAtom)
  const canTest = !props.readonly && canRun && resource.kind === 'app'
  const dialogId = useId()
  const mutationKey = ['human-input-template-test', dialogId]
  const client = useQueryClient()
  const actionsRef = useRef<DialogActions | null>(null)
  return (
    <Dialog<boolean>
      actionsRef={actionsRef}
      onOpenChange={(open, details) => {
        if (!open && client.isMutating({ mutationKey })) details.cancel()
      }}
    >
      {({ payload }) => (
        <>
          <div className="px-4">
            <div className="flex min-h-9 items-center gap-2 rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-2 shadow-xs">
              <span
                className="i-ri-mail-send-fill size-5 shrink-0 text-text-tertiary"
                aria-hidden
              />
              <DialogTrigger
                payload={false}
                className="min-w-0 grow truncate text-start system-sm-medium text-text-secondary"
              >
                {t(($) => $['nodes.humanInputV2.template.title'], { ns: 'workflow' })}
              </DialogTrigger>
              <Infotip>
                <InfotipTrigger
                  aria-label={t(($) => $['nodes.humanInputV2.template.description'], {
                    ns: 'workflow',
                  })}
                />
                <InfotipContent>
                  {t(($) => $['nodes.humanInputV2.template.description'], { ns: 'workflow' })}
                </InfotipContent>
              </Infotip>
              {canTest && (
                <DialogTrigger
                  payload
                  render={
                    <IconButton
                      aria-label={t(($) => $['nodes.humanInputV2.template.test'], {
                        ns: 'workflow',
                      })}
                    >
                      <span className="i-ri-send-plane-2-line size-4" aria-hidden />
                    </IconButton>
                  }
                />
              )}
              <DialogTrigger
                payload={false}
                render={
                  <IconButton aria-label={t(($) => $['common.configure'], { ns: 'workflow' })}>
                    <span className="i-ri-equalizer-2-line size-4" aria-hidden />
                  </IconButton>
                }
              />
            </div>
          </div>
          <DialogContent className="w-180">
            <MessageTemplateSession
              {...props}
              initialShowTest={payload ?? false}
              mutationKey={mutationKey}
              close={() => actionsRef.current?.close()}
            />
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}

export default MessageTemplate
