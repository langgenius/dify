'use client'
import type { FC } from 'react'
import type { FormInputItem, UserAction } from '../types'
import { zFormInputConfig, zUserActionConfig } from '@dify/contracts/api/web/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStore as useAppStore } from '@/app/components/app/store'
import Badge from '@/app/components/base/badge'
import { getButtonStyle } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { Markdown } from '@/app/components/base/markdown'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useStore } from '@/app/components/workflow/store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { consoleClient } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { normalizeHumanInputFormInput } from '../shared/types'
import { Note, rehypeNotes, rehypeVariable, Variable } from './variable-in-markdown'

const NODE_ID_RE = /#([^#.]+)([.#])/g
const i18nPrefix = 'nodes.humanInput'

type FormContentPreviewProps = {
  content: string
  formInputs: FormInputItem[]
  userActions: UserAction[]
  onClose: () => void
  nodeId?: string
  readOnly?: boolean
}

const FormContentPreview: FC<FormContentPreviewProps> = ({
  content,
  formInputs,
  userActions,
  onClose,
}) => {
  const { t } = useTranslation()
  const panelWidth = useStore((state) => state.panelWidth)
  const nodes = useNodes()

  const nodeName = React.useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId)
      return node?.data.title || nodeId
    },
    [nodes],
  )

  const renderInputPreview = React.useCallback(
    ({ node }: { node?: { properties?: Record<string, unknown> } }) => {
      const name = String(node?.properties?.dataName ?? '')
      const input = formInputs.find((i) => i.output_variable_name === name)
      if (!input) {
        return (
          <div>
            Can't find note:
            {name}
          </div>
        )
      }

      return <Note input={input} nodeName={nodeName} />
    },
    [formInputs, nodeName],
  )

  return (
    <div
      className="fixed top-28 z-10 max-h-[calc(100vh-116px)] w-150 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg py-3 shadow-xl"
      style={{
        right: panelWidth + 8,
      }}
    >
      <div className="flex h-6.5 items-center justify-between px-4">
        <Badge uppercase className="border-text-accent-secondary text-text-accent-secondary">
          {t(($) => $[`${i18nPrefix}.formContent.preview`], { ns: 'workflow' })}
        </Badge>
        <IconButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} onClick={onClose}>
          <span aria-hidden className="i-ri-close-line size-5 text-text-tertiary" />
        </IconButton>
      </div>
      <div className="max-h-[calc(100vh-167px)] overflow-y-auto px-4">
        <Markdown
          content={content}
          rehypePlugins={[rehypeVariable, rehypeNotes]}
          customComponents={{
            variable: ({ node }) => {
              const path = String(node?.properties?.dataPath ?? '')
              let newPath = path
              if (path) {
                newPath = path.replace(NODE_ID_RE, (match, nodeId, sep) => {
                  return `#${nodeName(nodeId)}${sep}`
                })
              }
              return <Variable path={newPath} />
            },
            section: renderInputPreview,
          }}
        />
        <div className="mt-3 flex flex-wrap gap-1 py-1">
          {userActions.map((action: UserAction) => (
            <Button key={action.id} variant={getButtonStyle(action.button_style)}>
              {action.title}
            </Button>
          ))}
        </div>
        <div className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['nodes.humanInput.editor.previewTip'], { ns: 'workflow' })}
        </div>
      </div>
    </div>
  )
}

const ServerFormContentPreview = (props: FormContentPreviewProps & { nodeId: string }) => {
  const { t } = useTranslation()
  const app = useAppStore((state) => state.appDetail)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const panelWidth = useStore((state) => state.panelWidth)
  const [result, setResult] = React.useState<{
    requestKey: string
    data?: Pick<FormContentPreviewProps, 'content' | 'formInputs' | 'userActions'>
    error?: string
  }>()
  const [attempt, retry] = React.useReducer((value) => value + 1, 0)
  const requestKey = JSON.stringify([app?.id, app?.mode, props.nodeId, attempt])
  const data = result?.requestKey === requestKey ? result.data : undefined
  const error = result?.requestKey === requestKey ? result.error : undefined
  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!app?.id) throw new Error(t(($) => $.error, { ns: 'common' }))
      if (!props.readOnly) {
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
        if (failed || (!saved && result == null))
          throw new Error(
            t(($) => $['nodes.humanInputV2.template.testSaveFailed'], { ns: 'workflow' }),
          )
      }
      if (cancelled) return
      const api =
        app.mode === AppModeEnum.WORKFLOW
          ? consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form
          : consoleClient.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form
      const response = await api.preview.post({
        params: { app_id: app.id, node_id: props.nodeId },
        body: { inputs: {} },
      })
      if (!cancelled)
        setResult({
          requestKey,
          data: {
            content: response.form_content,
            formInputs: (response.inputs ?? []).map((input) =>
              normalizeHumanInputFormInput(zFormInputConfig.parse(input)),
            ),
            userActions: (response.actions ?? []).map((action) => {
              const parsed = zUserActionConfig.parse(action)
              return { ...parsed, button_style: parsed.button_style ?? 'default' }
            }),
          },
        })
    }
    load().catch((error) => {
      if (!cancelled)
        setResult({
          requestKey,
          error: error instanceof Error ? error.message : t(($) => $.error, { ns: 'common' }),
        })
    })
    return () => {
      cancelled = true
    }
  }, [app?.id, app?.mode, props.nodeId, props.readOnly, doSyncWorkflowDraft, requestKey, t])
  if (data) return <FormContentPreview {...data} onClose={props.onClose} />
  return (
    <div
      role="status"
      className="fixed top-28 z-10 w-150 rounded-2xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xl"
      style={{ right: panelWidth + 8 }}
    >
      <div className="flex items-center justify-between gap-4">
        <span>{error ?? t(($) => $.loading, { ns: 'common' })}</span>
        <IconButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          onClick={props.onClose}
        >
          <span aria-hidden className="i-ri-close-line size-5" />
        </IconButton>
      </div>
      {error && (
        <Button className="mt-3" onClick={retry}>
          {t(($) => $['operation.retry'], { ns: 'common' })}
        </Button>
      )}
    </div>
  )
}

const HumanInputFormContentPreview = (props: FormContentPreviewProps) =>
  props.nodeId && !props.readOnly ? (
    <ServerFormContentPreview {...props} nodeId={props.nodeId} />
  ) : (
    <FormContentPreview {...props} />
  )

export default React.memo(HumanInputFormContentPreview)
