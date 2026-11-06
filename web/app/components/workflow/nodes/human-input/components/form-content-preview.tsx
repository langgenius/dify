'use client'
import type { FC } from 'react'
import type { FormInputItem, UserAction } from '../types'
import { zFormInputConfig, zUserActionConfig } from '@dify/contracts/api/console/apps/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { getButtonStyle } from '@/app/components/base/chat/chat/answer/human-input-content/utils'
import { Markdown } from '@/app/components/base/markdown'
import { SkeletonContainer, SkeletonRectangle } from '@/app/components/base/skeleton'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'
import { useNodesSyncDraft } from '@/app/components/workflow/hooks/use-nodes-sync-draft'
import { useStore } from '@/app/components/workflow/store'
import useNodes from '@/app/components/workflow/store/workflow/use-nodes'
import { consoleClient } from '@/service/console'
import { HumanInputDraftSyncError, syncHumanInputDraft } from '../shared/sync-draft'
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
  const { t } = useTranslation(['common', 'workflowHumanInput'])
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
          {t(($) => $[`${i18nPrefix}.formContent.preview`], { ns: 'workflowHumanInput' })}
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
          {t(($) => $['nodes.humanInput.editor.previewTip'], { ns: 'workflowHumanInput' })}
        </div>
      </div>
    </div>
  )
}

type PreviewTriggerProps = Omit<FormContentPreviewProps, 'onClose' | 'readOnly'>

const PreviewButton = ({
  open,
  onClick,
  buttonRef,
}: {
  open: boolean
  onClick: () => void
  buttonRef: React.RefObject<HTMLButtonElement | null>
}) => {
  const { t } = useTranslation(['workflowHumanInput'])
  return (
    <Button
      ref={buttonRef}
      variant="ghost"
      size="small"
      aria-pressed={open}
      className="flex items-center px-2 aria-pressed:bg-state-accent-active aria-pressed:text-text-accent"
      onClick={onClick}
    >
      <span className="i-ri-eye-line size-3.5" aria-hidden />
      <span className="system-xs-medium">
        {t(($) => $['nodes.humanInput.formContent.preview'], { ns: 'workflowHumanInput' })}
      </span>
    </Button>
  )
}

const ServerPreviewTrigger = ({ nodeId }: PreviewTriggerProps & { nodeId: string }) => {
  const { t } = useTranslation(['workflow', 'common'])
  const resource = useAtomValue(editorResourceAtom)
  const { doSyncWorkflowDraft } = useNodesSyncDraft()
  const panelWidth = useStore((state) => state.panelWidth)
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const preview = useMutation({
    mutationFn: async () => {
      if (resource.kind !== 'app') throw new Error('Missing application')
      await syncHumanInputDraft(doSyncWorkflowDraft)
      const api =
        resource.mode === 'workflow'
          ? consoleClient.apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.form
          : consoleClient.apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.form
      const response = await api.preview.post(
        {
          params: { app_id: resource.appId, node_id: nodeId },
          body: { inputs: {} },
        },
        { context: { silent: true } },
      )
      return {
        content: response.form_content,
        formInputs: (response.inputs ?? []).map((input) =>
          normalizeHumanInputFormInput(zFormInputConfig.parse(input)),
        ),
        userActions: (response.actions ?? []).map((action) => {
          const parsed = zUserActionConfig.parse(action)
          return { ...parsed, button_style: parsed.button_style ?? 'default' }
        }),
      }
    },
  })
  const close = () => {
    setOpen(false)
    preview.reset()
    buttonRef.current?.focus()
  }
  const toggle = () => {
    if (open) close()
    else {
      setOpen(true)
      preview.mutate()
    }
  }
  return (
    <>
      <p role="status" className="sr-only">
        {open && preview.isPending ? t(($) => $.loading, { ns: 'common' }) : ''}
      </p>
      <PreviewButton open={open} onClick={toggle} buttonRef={buttonRef} />
      {open &&
        (preview.data ? (
          <FormContentPreview {...preview.data} onClose={close} />
        ) : (
          <div
            className="fixed top-28 z-10 w-150 rounded-2xl border border-components-panel-border bg-components-panel-bg p-4 shadow-xl"
            style={{ right: panelWidth + 8 }}
          >
            <div className="flex items-center justify-between gap-4">
              {preview.isError ? (
                <p role="alert">
                  {preview.error instanceof HumanInputDraftSyncError
                    ? t(($) => $['nodes.humanInputV2.template.testSaveFailed'], { ns: 'workflow' })
                    : t(($) => $.error, { ns: 'common' })}
                </p>
              ) : (
                <SkeletonContainer aria-hidden className="grow">
                  <SkeletonRectangle className="h-4 w-1/3" />
                  <SkeletonRectangle className="h-16 w-full" />
                </SkeletonContainer>
              )}
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                onClick={close}
              >
                <span aria-hidden className="i-ri-close-line size-5" />
              </IconButton>
            </div>
            {preview.isError && (
              <Button className="mt-3" onClick={() => preview.mutate()}>
                {t(($) => $['operation.retry'], { ns: 'common' })}
              </Button>
            )}
          </div>
        ))}
    </>
  )
}

const LocalPreviewTrigger = (props: PreviewTriggerProps) => {
  const [open, setOpen] = React.useState(false)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }
  return (
    <>
      <PreviewButton open={open} onClick={() => setOpen(!open)} buttonRef={buttonRef} />
      {open && <FormContentPreview {...props} onClose={close} />}
    </>
  )
}

export const FormContentPreviewTrigger = (props: PreviewTriggerProps) =>
  props.nodeId ? (
    <ServerPreviewTrigger key={props.nodeId} {...props} nodeId={props.nodeId} />
  ) : (
    <LocalPreviewTrigger {...props} />
  )

export default React.memo(FormContentPreview)
