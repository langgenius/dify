import type { ExternalAgentWorkflowPreviewNodeData } from './types'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@langgenius/dify-ui/menu'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BlockIcon from '@/app/components/workflow/block-icon'
import { useCollaborativeWorkflow } from '@/app/components/workflow/hooks/use-collaborative-workflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useNodesInteractions } from '@/app/components/workflow/hooks/use-nodes-interactions'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { TitleInput } from '@/app/components/workflow/nodes/_base/components/title-description-input'
import NoLastRunData from '@/app/components/workflow/nodes/_base/components/workflow-panel/last-run/no-data'
import { AgentOutputVariables } from '@/app/components/workflow/nodes/agent-v2/components/agent-output-variables'
import { BlockEnum } from '@/app/components/workflow/types'
import { ExternalAgentField } from './agent-field'
import { ExternalAgentWorkflowSettings } from './external-settings'
import { externalAgentDefaultOutputs, externalAgentDefaultWaitLimit } from './preview'
import { ExternalAgentTaskField } from './task-field'
import { isExternalAgentWorkflowPreviewData } from './types'

const externalReservedOutputNames: ReadonlySet<string> = new Set()

type PreviewUpdate =
  | Partial<ExternalAgentWorkflowPreviewNodeData>
  | ((
      current: ExternalAgentWorkflowPreviewNodeData,
    ) => Partial<ExternalAgentWorkflowPreviewNodeData>)

export function ExternalAgentWorkflowPreviewPanel({
  id,
  data,
}: {
  id: string
  data: ExternalAgentWorkflowPreviewNodeData
}) {
  const { t } = useTranslation(['agentRoster', 'common', 'workflow', 'workflowDebug'])
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const { handleNodeDelete, handleNodeSelect } = useNodesInteractions()
  const [tab, setTab] = useState<'settings' | 'lastRun'>('settings')
  const [outputsCollapsed, setOutputsCollapsed] = useState(false)
  const titleContainerRef = useRef<HTMLDivElement>(null)
  const renameRequestedRef = useRef(false)
  const descriptionId = useId()
  const agent = data.external_agent
  const task = data.agent_task ?? ''
  const outputs = data.agent_declared_outputs ?? externalAgentDefaultOutputs
  const waitLimit = { ...externalAgentDefaultWaitLimit, ...data.external_agent_wait_limit }
  const update = useCallback(
    (patch: PreviewUpdate) => {
      const current = collaborativeWorkflow.getState().nodes.find((node) => node.id === id)
      if (!current || !isExternalAgentWorkflowPreviewData(current.data)) return
      handleNodeDataUpdateWithSyncDraft({
        id,
        data: typeof patch === 'function' ? patch(current.data) : patch,
      })
    },
    [id, collaborativeWorkflow, handleNodeDataUpdateWithSyncDraft],
  )
  const close = () => handleNodeSelect(id, true)
  const remove = () => handleNodeDelete(id)
  const runLabel = t(($) => $['panel.runThisStep'], { ns: 'workflow' })

  return (
    <section
      aria-label={agent.name}
      className="me-1 flex h-full w-100 max-w-full shrink-0 flex-col overflow-hidden rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => {
          if (value === 'settings' || value === 'lastRun') setTab(value)
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="shrink-0 border-b border-divider-subtle px-4 pt-4">
          <div className="flex h-7 items-center gap-1">
            <BlockIcon type={BlockEnum.AgentV2} size="md" />
            <div ref={titleContainerRef} className="min-w-0 flex-1">
              <TitleInput value={data.title || agent.name} onBlur={(title) => update({ title })} />
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <IconButton aria-label={runLabel} disabled focusableWhenDisabled>
                    <span aria-hidden className="i-ri-play-line size-4" />
                  </IconButton>
                }
              />
              <TooltipContent>{t(($) => $['external.workflow.runUnavailable'])}</TooltipContent>
            </Tooltip>
            <Menu
              onOpenChange={(open) => {
                if (open) renameRequestedRef.current = false
              }}
            >
              <MenuTrigger
                render={
                  <IconButton aria-label={t(($) => $['operation.more'], { ns: 'common' })}>
                    <span aria-hidden className="i-ri-more-fill size-4" />
                  </IconButton>
                }
              />
              <MenuContent
                finalFocus={() =>
                  renameRequestedRef.current
                    ? (titleContainerRef.current?.querySelector('input') ?? true)
                    : true
                }
              >
                <MenuItem
                  onClick={() => {
                    renameRequestedRef.current = true
                  }}
                >
                  <span aria-hidden className="i-ri-pencil-line size-4" />
                  {t(($) => $['operation.rename'], { ns: 'common' })}
                </MenuItem>
                <MenuItem onClick={remove} className="text-text-destructive">
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                  {t(($) => $['operation.delete'], { ns: 'common' })}
                </MenuItem>
              </MenuContent>
            </Menu>
            <span aria-hidden className="mx-2 h-3.5 w-px bg-divider-subtle" />
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              onClick={close}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          </div>
          <label htmlFor={descriptionId} className="sr-only">
            {t(($) => $['common.nodeDescription'], { ns: 'workflow' })}
          </label>
          <textarea
            id={descriptionId}
            rows={1}
            value={data.desc || ''}
            onChange={(event) => update({ desc: event.target.value })}
            placeholder={t(($) => $['common.addDescription'], { ns: 'workflow' })}
            className="mt-1 block h-5 w-full resize-none rounded-sm bg-transparent py-0.5 system-xs-regular text-text-secondary outline-hidden placeholder:text-text-quaternary focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
          />
          <TabsList aria-label={t(($) => $['external.overview.type'])} className="mt-0.5 h-8 gap-4">
            <TabsTab
              value="settings"
              className="border-b-2 py-1 system-sm-medium uppercase data-active:text-text-primary"
            >
              {t(($) => $['debug.settingsTab'], { ns: 'workflowDebug' })}
            </TabsTab>
            <TabsTab value="lastRun" className="border-b-2 py-1 system-sm-medium uppercase">
              {t(($) => $['debug.lastRunTab'], { ns: 'workflowDebug' })}
            </TabsTab>
          </TabsList>
        </header>
        <TabsPanel value="settings" className="min-h-0 flex-1 overflow-y-auto pb-4">
          <ExternalAgentField
            agent={agent}
            onChange={(next) =>
              update((current) => ({
                external_agent: next,
                title: current.title === current.external_agent.name ? next.name : current.title,
              }))
            }
          />
          <ExternalAgentTaskField
            id={id}
            value={task}
            outputs={outputs}
            onChange={(agent_task) => update({ agent_task })}
            onOutputsChange={(agent_declared_outputs, agent_task) =>
              update({
                agent_declared_outputs,
                ...(agent_task === undefined ? {} : { agent_task }),
              })
            }
          />
          <div className="border-b border-divider-subtle">
            <AgentOutputVariables
              compact
              reservedOutputNames={externalReservedOutputNames}
              outputs={outputs}
              collapsed={outputsCollapsed}
              onCollapse={setOutputsCollapsed}
              onChange={(agent_declared_outputs) => update({ agent_declared_outputs })}
            />
          </div>
          <ExternalAgentWorkflowSettings
            waitLimit={waitLimit}
            onWaitLimitChange={(changes) =>
              update((current) => ({
                external_agent_wait_limit: {
                  ...externalAgentDefaultWaitLimit,
                  ...current.external_agent_wait_limit,
                  ...changes,
                },
              }))
            }
            errorStrategy={data.error_strategy ?? ErrorHandleTypeEnum.failBranch}
            onErrorStrategyChange={(error_strategy) => update({ error_strategy })}
          />
        </TabsPanel>
        <TabsPanel value="lastRun" className="flex min-h-0 flex-1 flex-col">
          <NoLastRunData canSingleRun={false} onSingleRun={() => {}} />
        </TabsPanel>
      </Tabs>
    </section>
  )
}
