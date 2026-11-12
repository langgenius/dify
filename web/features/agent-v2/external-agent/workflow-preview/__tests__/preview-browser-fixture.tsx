import type { ExternalAgentWorkflowPreviewNodeData } from '../types'
import type { Shape as WorkflowStoreShape } from '@/app/components/workflow/store/workflow'
import type { WorkflowDataUpdater } from '@/app/components/workflow/types'
import type { consoleClient } from '@/service/console'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { ReactFlowProvider } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { FeaturesProvider } from '@/app/components/base/features'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { WorkflowContext } from '@/app/components/workflow/context'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createExternalRosterPreview } from '@/features/agent-v2/roster/external-roster-preview'
import agentRoster from '@/i18n/locales/en-US/agent-roster.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import workflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import workflowDebug from '@/i18n/locales/en-US/workflow-debug.json'
import workflow from '@/i18n/locales/en-US/workflow.json'
import { seedExternalAgentWorkflowQueries } from '@/test/console/external-agent-workflow'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createExternalAgentWorkflowPreviewData } from '../preview'
import { ExternalAgentWorkflowCanvas } from './preview-browser-canvas'

export function createExternalAgentWorkflowGraph({
  nodeData = {},
  withErrorBranches = false,
}: {
  nodeData?: Partial<ExternalAgentWorkflowPreviewNodeData>
  withErrorBranches?: boolean
} = {}): WorkflowDataUpdater {
  const agent = createExternalRosterPreview()[1]!
  const data: ExternalAgentWorkflowPreviewNodeData = {
    type: BlockEnum.Agent,
    title: 'Agent',
    desc: '',
    selected: true,
    ...createExternalAgentWorkflowPreviewData(agent),
    ...nodeData,
  }
  const nodes = [
    createNode({
      id: 'input',
      position: { x: 0, y: 0 },
      data: {
        type: BlockEnum.Start,
        title: 'Input',
        variables: [
          {
            variable: 'contract_text',
            type: InputVarType.paragraph,
            label: 'Contract text',
            required: false,
          },
        ],
      },
    }),
    createNode({
      id: 'policy',
      position: { x: 0, y: 100 },
      data: {
        type: BlockEnum.Code,
        title: 'Policy',
        outputs: { result: { type: VarType.string } },
      },
    }),
    createNode({ id: 'external-agent', position: { x: 160, y: 50 }, selected: true, data }),
  ]
  const edges = [
    createEdge({ source: 'input', target: 'policy' }),
    createEdge({ source: 'policy', target: 'external-agent' }),
  ]
  if (withErrorBranches) {
    nodes.push(
      createNode({
        id: 'success-handler',
        position: { x: 480, y: 0 },
        data: { title: 'Success handler', outputs: {} },
      }),
      createNode({
        id: 'failure-handler',
        position: { x: 480, y: 160 },
        data: { title: 'Failure handler', outputs: {} },
      }),
    )
    edges.push(
      createEdge({
        id: 'failure-connection',
        source: 'external-agent',
        target: 'failure-handler',
        sourceHandle: 'fail-branch',
        ariaLabel: 'Failure connection',
      }),
      createEdge({
        id: 'normal-connection',
        source: 'external-agent',
        target: 'success-handler',
        sourceHandle: 'source',
        ariaLabel: 'Normal connection',
      }),
      createEdge({
        id: 'unrelated-connection',
        source: 'success-handler',
        target: 'failure-handler',
        sourceHandle: 'source',
        ariaLabel: 'Unrelated connection',
      }),
    )
  }
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

export async function renderExternalAgentWorkflow({
  graph,
  name = 'Contract Review Agent',
  initialStoreState = {},
}: {
  graph?: WorkflowDataUpdater
  name?: string
  initialStoreState?: Partial<WorkflowStoreShape>
} = {}) {
  await page.viewport(1280, 1000)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { agentRoster, app, common, workflowAgent, workflowDebug, workflow } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
  })
  seedExternalAgentWorkflowQueries(queryClient, 'external-preview-app')
  const store = createWorkflowStore({})
  store.setState({ isWorkflowDataLoaded: true, ...initialStoreState })
  const rendered = await render(
    <QueryProvider>
      <EditorResourceScope
        resource={{
          kind: 'app',
          appId: 'external-preview-app',
          mode: 'workflow',
          collaborationEnabled: false,
        }}
      >
        <WorkflowContext value={store}>
          <FeaturesProvider>
            <EventEmitterContextProvider>
              <I18nextProvider i18n={i18n}>
                <ReactFlowProvider>
                  <ExternalAgentWorkflowCanvas
                    graph={graph ?? createExternalAgentWorkflowGraph()}
                  />
                </ReactFlowProvider>
              </I18nextProvider>
            </EventEmitterContextProvider>
          </FeaturesProvider>
        </WorkflowContext>
      </EditorResourceScope>
    </QueryProvider>,
  )
  const panel = page.getByRole('region', { name, exact: true })
  return {
    panel,
    canvas: page.getByRole('region', { name: 'Agent canvas', exact: true }),
    workflowStore: store,
    queryClient,
    unmount: rendered.unmount,
  }
}

export function createSerializedWorkflowDraftStorage() {
  let saved = JSON.stringify(createWorkflowResponseFixture())
  const save: typeof consoleClient.apps.byAppId.workflows.draft.post = async ({ body }) => {
    saved = JSON.stringify(createWorkflowResponseFixture({ graph: body.graph, hash: 'saved-hash' }))
    return { result: 'success', hash: 'saved-hash', updated_at: 2 }
  }
  const read: typeof consoleClient.apps.byAppId.workflows.draft.get = async () => JSON.parse(saved)
  return { save, read }
}
