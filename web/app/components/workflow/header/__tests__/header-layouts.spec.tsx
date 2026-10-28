import type { Shape } from '../../store/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { createAccountProfileQueryClient } from '@/test/console/account-profile'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import {
  createConsoleQueryWrapper,
  seedAppDslVersion,
  seedSystemFeatures,
} from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { createStartNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { collaborationManager } from '../../collaboration/core/collaboration-manager'
import DatasetsDetailProvider from '../../datasets-detail-store/provider'
import { fullWorkflowAccessControl } from '../../hooks-store/store'
import { WorkflowVersion } from '../../types'
import HeaderInNormal from '../header-in-normal'
import HeaderInRestoring from '../header-in-restoring'
import HeaderInHistory from '../header-in-view-history'

const mockHandleBackupDraft = vi.fn()
const mockHandleLoadBackupDraft = vi.fn()
const mockHandleRefreshWorkflowDraft = vi.fn()
const mockRestoreWorkflow = vi.fn()
const mockNotify = vi.fn()

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.byWorkflowId.restore.post': (input) =>
        mockRestoreWorkflow('app', input),
      'rag.pipelines.byPipelineId.workflows.byWorkflowId.restore.post': (input) =>
        mockRestoreWorkflow('pipeline', input),
      'snippets.bySnippetId.workflows.byWorkflowId.restore.post': (input) =>
        mockRestoreWorkflow('snippet', input),
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

const createBackupDraft = (): NonNullable<Shape['backupDraft']> => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  environmentVariables: [],
})

const createCurrentVersion = (): NonNullable<Shape['currentVersion']> => ({
  id: 'version-1',
  graph: {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'Tester',
    email: 'tester@example.com',
  },
  hash: 'hash-1',
  updated_at: 0,
  updated_by: {
    id: 'user-1',
    name: 'Tester',
    email: 'tester@example.com',
  },
  tool_published: false,
  environment_variables: [],
  version: WorkflowVersion.Latest,
  version_number: 5,
  marked_name: '',
  marked_comment: '',
})

describe('Header layout components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(collaborationManager, 'emitRestoreIntent').mockImplementation(() => {})
    vi.spyOn(collaborationManager, 'emitRestoreComplete').mockImplementation(() => {})
    vi.spyOn(collaborationManager, 'emitWorkflowUpdate').mockImplementation(() => {})
    mockRestoreWorkflow.mockReset().mockResolvedValue(createWorkflowResponseFixture())
  })

  afterEach(() => vi.restoreAllMocks())

  describe('HeaderInNormal', () => {
    it.each([false, true])(
      'keeps an existing Builder session toggle available with canvasReadOnly=%s',
      async (canvasReadOnly) => {
        const user = userEvent.setup()
        const { store } = renderWorkflowComponent(
          <HeaderInNormal
            controls={{ showDifyBuilderButton: true, hasDifyBuilderSession: true }}
          />,
          { initialStoreState: { canvasReadOnly, workflowDraftSyncPhase: 'builder' } },
        )
        const toggle = screen.getByRole('button', { name: 'difyBuilder.buttonTooltip' })
        expect(toggle).toBeEnabled()
        await user.click(toggle)
        expect(store.getState().showDifyBuilderPanel).toBe(true)
        await user.click(toggle)
        expect(store.getState().showDifyBuilderPanel).toBe(false)
      },
    )

    it.each([
      { canvasReadOnly: true, canEdit: true, hasSession: false },
      { canvasReadOnly: false, canEdit: false, hasSession: true },
    ])(
      'keeps Builder unavailable without edit access or an unlocked canvas: %j',
      ({ canvasReadOnly, canEdit, hasSession }) => {
        renderWorkflowComponent(
          <HeaderInNormal
            controls={{ showDifyBuilderButton: true, hasDifyBuilderSession: hasSession }}
          />,
          {
            initialStoreState: { canvasReadOnly },
            hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canEdit } },
          },
        )
        expect(screen.getByRole('button', { name: 'difyBuilder.buttonTooltip' })).toBeDisabled()
      },
    )
    it('opens version history, backs up the draft, and closes editing panels', async () => {
      const user = userEvent.setup()

      const { store } = renderWorkflowComponent(<HeaderInNormal />, {
        nodes: [createStartNode({ id: 'node-selected', data: { selected: true } })],
        initialStoreState: {
          showEnvPanel: true,
          showDebugAndPreviewPanel: true,
          showVariableInspectPanel: true,
          showChatVariablePanel: true,
          showGlobalVariablePanel: true,
        },
      })

      expect(
        screen.getByRole('status', { name: 'workflow.common.workflowSaveStatus' }),
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }),
      ).toBeVisible()
      expect(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'workflow.globalVar.title' })).toBeEnabled()
      expect(screen.getByRole('button', { name: 'workflow.common.viewRunHistory' })).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'workflow.common.versionHistory' }))

      expect(mockHandleBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().isRestoring).toBe(true)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(true)
      expect(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      expect(
        screen.queryByRole('button', { name: 'workflow.panel.scrollToSelectedNode' }),
      ).not.toBeInTheDocument()
      expect(store.getState().showDebugAndPreviewPanel).toBe(false)
      expect(store.getState().showVariableInspectPanel).toBe(false)
      expect(store.getState().showChatVariablePanel).toBe(false)
      expect(screen.getByRole('button', { name: 'workflow.globalVar.title' })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    })

    it('disables variable editing on a read-only canvas', () => {
      renderWorkflowComponent(<HeaderInNormal />, { initialStoreState: { canvasReadOnly: true } })
      expect(screen.getByRole('button', { name: 'workflow.env.envPanelTitle' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'workflow.globalVar.title' })).toBeDisabled()
    })

    it('should hide env and global variable buttons when the controls are disabled', () => {
      renderWorkflowComponent(
        <HeaderInNormal
          controls={{
            showEnvButton: false,
            showGlobalVariableButton: false,
          }}
        />,
      )

      expect(
        screen.queryByRole('button', { name: 'workflow.env.envPanelTitle' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'workflow.globalVar.title' }),
      ).not.toBeInTheDocument()
    })
  })

  describe('HeaderInRestoring', () => {
    it('disables restoring an unpublished draft', () => {
      renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          currentVersion: { ...createCurrentVersion(), version: WorkflowVersion.Draft },
        },
      })
      expect(screen.getByRole('button', { name: 'workflow.common.restore' })).toBeDisabled()
    })

    it('opens the upgrade dialog without restoring for a Cloud sandbox workspace', async () => {
      const user = userEvent.setup()
      const { queryClient } = createConsoleQueryWrapper({
        systemFeatures: { deployment_edition: 'CLOUD' },
        features: { billing: { subscription: { plan: 'sandbox' } } },
      })
      renderWorkflowComponent(<HeaderInRestoring />, {
        queryClient,
        initialStoreState: { currentVersion: createCurrentVersion() },
      })
      await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
      expect(
        await screen.findByRole('dialog', { name: 'billing.upgrade.workflowRestore.title' }),
      ).toBeVisible()
      expect(mockRestoreWorkflow).not.toHaveBeenCalled()
      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
    })

    it('should cancel restoring mode and reopen the editor state', async () => {
      const user = userEvent.setup()
      const { store } = renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          isRestoring: true,
          showWorkflowVersionHistoryPanel: true,
        },
        resource: { kind: 'app' as const, appId: 'flow-1', mode: 'workflow' as const },
        hooksStoreProps: {
          fileSettings: {},
        },
      })

      await user.click(screen.getByRole('button', { name: 'workflow.common.exitVersions' }))

      expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().isRestoring).toBe(false)
      expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
    })

    it('should restore the selected version, clear backup state, and forward lifecycle callbacks', async () => {
      const user = userEvent.setup()
      const onRestoreSettled = vi.fn()
      const deleteAllInspectVars = vi.fn()
      const currentVersion = createCurrentVersion()
      const currentUser = { id: 'user-1', name: 'Alice' }
      const queryClient = createAccountProfileQueryClient(currentUser)
      seedSystemFeatures(queryClient)

      const { store } = renderWorkflowComponent(
        <HeaderInRestoring onRestoreSettled={onRestoreSettled} />,
        {
          initialStoreState: {
            isRestoring: true,
            showWorkflowVersionHistoryPanel: true,
            backupDraft: createBackupDraft(),
            currentVersion,
            deleteAllInspectVars,
          },
          resource: { kind: 'app' as const, appId: 'flow-1', mode: 'workflow' as const },
          hooksStoreProps: {
            fileSettings: {},
          },
          queryClient,
        },
      )

      await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('app', {
          params: { app_id: 'flow-1', workflow_id: 'version-1' },
        })
        expect(store.getState().showWorkflowVersionHistoryPanel).toBe(false)
        expect(store.getState().isRestoring).toBe(false)
        expect(store.getState().backupDraft).toBeUndefined()
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
        expect(deleteAllInspectVars).toHaveBeenCalledTimes(1)
        expect(mockNotify).toHaveBeenCalledWith({
          type: 'success',
          message: 'workflowHistory.versionHistory.action.restoreSuccess',
        })
      })
      expect(collaborationManager.emitRestoreIntent).toHaveBeenCalledWith({
        versionId: currentVersion.id,
        versionName: '# 5',
        initiatorUserId: currentUser.id,
        initiatorName: currentUser.name,
      })
      expect(collaborationManager.emitRestoreComplete).toHaveBeenCalledWith({
        versionId: currentVersion.id,
        success: true,
      })
      expect(collaborationManager.emitWorkflowUpdate).toHaveBeenCalledWith('flow-1')
      expect(onRestoreSettled).toHaveBeenCalledTimes(1)
    })

    it('keeps the draft recoverable and reports failure when restoration is rejected', async () => {
      const user = userEvent.setup()
      mockRestoreWorkflow.mockRejectedValueOnce(new Error('Restore failed'))
      const backupDraft = createBackupDraft()
      const onRestoreSettled = vi.fn()
      const { store } = renderWorkflowComponent(
        <HeaderInRestoring onRestoreSettled={onRestoreSettled} />,
        {
          initialStoreState: {
            isRestoring: true,
            backupDraft,
            currentVersion: createCurrentVersion(),
          },
          resource: { kind: 'app', appId: 'flow-1', mode: 'workflow' },
        },
      )

      await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => expect(onRestoreSettled).toHaveBeenCalledTimes(1))
      expect(store.getState().isRestoring).toBe(true)
      expect(store.getState().backupDraft).toEqual(backupDraft)
      expect(mockHandleRefreshWorkflowDraft).not.toHaveBeenCalled()
      expect(collaborationManager.emitWorkflowUpdate).not.toHaveBeenCalled()
      expect(collaborationManager.emitRestoreComplete).toHaveBeenCalledWith({
        versionId: 'version-1',
        success: false,
        error: 'restore failed',
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'workflowHistory.versionHistory.action.restoreFailure',
      })
    })

    it('should restore rag pipeline versions without emitting collaboration events', async () => {
      const user = userEvent.setup()
      const currentVersion = createCurrentVersion()

      renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          isRestoring: true,
          showWorkflowVersionHistoryPanel: true,
          backupDraft: createBackupDraft(),
          currentVersion,
        },
        resource: { kind: 'knowledge-pipeline' as const, pipelineId: 'pipeline-1' },
        hooksStoreProps: {
          fileSettings: {},
        },
      })

      await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('pipeline', {
          params: { pipeline_id: 'pipeline-1', workflow_id: 'version-1' },
        })
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      })
      expect(collaborationManager.emitRestoreIntent).not.toHaveBeenCalled()
      expect(collaborationManager.emitRestoreComplete).not.toHaveBeenCalled()
      expect(collaborationManager.emitWorkflowUpdate).not.toHaveBeenCalled()
    })

    it('should restore snippet versions through snippet routes without emitting collaboration events', async () => {
      const user = userEvent.setup()
      const currentVersion = createCurrentVersion()

      renderWorkflowComponent(<HeaderInRestoring />, {
        initialStoreState: {
          isRestoring: true,
          showWorkflowVersionHistoryPanel: true,
          backupDraft: createBackupDraft(),
          currentVersion,
        },
        resource: { kind: 'snippet' as const, snippetId: 'snippet-1' },
        hooksStoreProps: {
          fileSettings: {},
        },
      })

      await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))

      await waitFor(() => {
        expect(mockRestoreWorkflow).toHaveBeenCalledWith('snippet', {
          params: { snippet_id: 'snippet-1', workflow_id: 'version-1' },
        })
        expect(mockHandleRefreshWorkflowDraft).toHaveBeenCalledTimes(1)
      })
      expect(collaborationManager.emitRestoreIntent).not.toHaveBeenCalled()
      expect(collaborationManager.emitRestoreComplete).not.toHaveBeenCalled()
      expect(collaborationManager.emitWorkflowUpdate).not.toHaveBeenCalled()
    })
  })

  describe('HeaderInHistory', () => {
    it('exits run history and restores the backup draft', async () => {
      const user = userEvent.setup()
      const { store } = renderWorkflowComponent(
        <HeaderInHistory viewHistoryProps={{ historyUrl: '/history' }} />,
        {
          initialStoreState: {
            historyWorkflowData: {
              id: 'history-1',
              status: 'succeeded',
            },
          },
        },
      )

      expect(screen.getByText('workflow.common.viewOnly')).toBeVisible()
      expect(screen.getByRole('button', { name: 'workflow.common.showRunHistory' })).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'workflow.common.goBackToEdit' }))

      expect(mockHandleLoadBackupDraft).toHaveBeenCalledTimes(1)
      expect(store.getState().historyWorkflowData).toBeUndefined()
    })
  })
})

function renderWorkflowComponent(
  ui: Parameters<typeof renderWorkflowFlowComponent>[0],
  options: Parameters<typeof renderWorkflowFlowComponent>[1] = {},
) {
  const { queryClient } = createConsoleQueryWrapper({ queryClient: options.queryClient })
  seedAppDslVersion(queryClient)
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  const nodes = options.nodes ?? []
  return renderWorkflowFlowComponent(
    <NuqsTestingAdapter>
      <DatasetsDetailProvider nodes={nodes}>{ui}</DatasetsDetailProvider>
    </NuqsTestingAdapter>,
    {
      ...options,
      queryClient,
      nodes,
      hooksStoreProps: {
        handleBackupDraft: mockHandleBackupDraft,
        handleLoadBackupDraft: mockHandleLoadBackupDraft,
        handleRefreshWorkflowDraft: mockHandleRefreshWorkflowDraft,
        ...options.hooksStoreProps,
      },
    },
  )
}
