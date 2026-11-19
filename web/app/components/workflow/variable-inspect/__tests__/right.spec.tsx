import type { currentVarType } from '../panel'
import type { VarInInspect } from '@/types/workflow'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { VarInInspectType } from '@/types/workflow'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { HooksStoreContextProvider } from '../../hooks-store/provider'
import useCurrentVars from '../../hooks/use-inspect-vars-crud'
import { useInspectVarsCrudCommon } from '../../hooks/use-inspect-vars-crud-common'
import { useStore } from '../../store'
import { BlockEnum, VarType } from '../../types'
import Right from '../right'
const createVariable = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: VarInInspectType.node,
  name: 'result',
  description: '',
  selector: ['node-1', 'result'],
  value_type: VarType.string,
  value: 'value',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 0,
    download_url: '',
  },
  ...overrides,
})

const requests = vi.hoisted(() => ({ reset: vi.fn(), conversation: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggers.get': async () => [],
      'apps.byAppId.workflows.draft.variables.byVariableId.reset.put': requests.reset,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.conversationVariables.get': requests.conversation,
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

function LiveRight({
  initial,
  handleOpenMenu,
}: {
  initial: currentVarType
  handleOpenMenu: () => void
}) {
  const nodeVars = useStore((s) => s.nodesWithInspectVars)
  const { conversationVars } = useCurrentVars()
  const variable =
    initial.var.type === VarInInspectType.conversation
      ? conversationVars.find((v) => v.id === initial.var.id)
      : nodeVars.find((n) => n.nodeId === initial.nodeId)?.vars.find((v) => v.id === initial.var.id)
  return (
    <Right
      nodeId={initial.nodeId}
      currentNodeVar={variable ? { ...initial, var: variable } : undefined}
      handleOpenMenu={handleOpenMenu}
    />
  )
}

function InspectOwner(props: { initial: currentVarType; handleOpenMenu: () => void }) {
  const owner = useInspectVarsCrudCommon()
  return (
    <HooksStoreContextProvider {...owner}>
      <LiveRight {...props} />
    </HooksStoreContextProvider>
  )
}

const createCurrentNodeVar = (overrides: Partial<VarInInspect> = {}): currentVarType => ({
  nodeId: 'node-1',
  nodeType: BlockEnum.Code,
  title: 'Code',
  nodeData: {
    type: BlockEnum.Code,
    title: 'Code',
    desc: '',
  },
  var: createVariable(overrides),
})

const renderRight = (
  currentNodeVar: currentVarType,
  options: { bottomPanelWidth?: number; handleOpenMenu?: () => void } = {},
) => {
  const handleOpenMenu = options.handleOpenMenu ?? vi.fn()
  const { queryClient } = createConsoleQueryWrapper()
  seedModelProviderQueries(queryClient)
  seedAppDslVersion(queryClient)
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    {
      items:
        currentNodeVar.var.type === VarInInspectType.conversation
          ? [{ ...currentNodeVar.var, value: currentNodeVar.var.value ?? null, full_content: null }]
          : [],
    },
  )
  const result = renderWorkflowFlowComponent(
    <InspectOwner initial={currentNodeVar} handleOpenMenu={handleOpenMenu} />,
    {
      queryClient,
      nodes: [createNode({ id: 'node-1', data: { type: BlockEnum.Code, title: 'Code' } })],
      edges: [],
      initialStoreState: {
        bottomPanelWidth: options.bottomPanelWidth ?? 560,
        nodesWithInspectVars:
          currentNodeVar.var.type === VarInInspectType.conversation
            ? []
            : [
                {
                  nodeId: currentNodeVar.nodeId,
                  nodeType: BlockEnum.Code,
                  title: 'Code',
                  nodePayload: currentNodeVar.nodeData,
                  vars: [currentNodeVar.var],
                },
              ],
      },
    },
  )

  return { ...result, handleOpenMenu }
}

describe('VariableInspect Right', () => {
  beforeEach(() => {
    requests.conversation.mockResolvedValue({ items: [] })
    requests.reset.mockResolvedValue({
      ...createVariable({ value: 'last run value' }),
      full_content: null,
    })
  })

  it('opens the variable menu from the named narrow-panel command', async () => {
    const user = userEvent.setup()
    const { handleOpenMenu } = renderRight(createCurrentNodeVar(), { bottomPanelWidth: 400 })

    await user.click(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.title' }),
    )

    expect(handleOpenMenu).toHaveBeenCalledTimes(1)
  })

  it('exposes the full-content download as a named link', () => {
    renderRight(
      createCurrentNodeVar({
        is_truncated: true,
        full_content: {
          size_bytes: 1024,
          download_url: 'https://example.com/result.txt',
        },
      }),
    )

    expect(
      screen.getByRole('link', { name: 'workflowDebug.debug.variableInspect.exportToolTip' }),
    ).toHaveAttribute('href', 'https://example.com/result.txt')
  })

  it('resets an edited node variable from its named command', async () => {
    const user = userEvent.setup()

    const { store } = renderRight(createCurrentNodeVar({ edited: true }))
    expect(screen.getByRole('textbox')).toHaveValue('value')

    await user.click(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.reset' }),
    )

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('last run value'))
    expect(
      screen.queryByRole('button', { name: 'workflowDebug.debug.variableInspect.reset' }),
    ).not.toBeInTheDocument()
    expect(store.getState().nodesWithInspectVars[0]?.vars[0]).toMatchObject({
      id: 'var-1',
      value: 'last run value',
      edited: false,
    })
    expect(requests.reset).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1', variable_id: 'var-1' },
    })
  })

  it('resets an edited conversation variable from its named command', async () => {
    const user = userEvent.setup()

    const variable = createVariable({
      type: VarInInspectType.conversation,
      selector: ['conversation', 'result'],
      edited: true,
    })
    requests.conversation.mockResolvedValue({ items: [variable] })
    requests.reset.mockImplementation(async () => {
      requests.conversation.mockResolvedValue({
        items: [{ ...variable, value: 'conversation default', edited: false, full_content: null }],
      })
      return { ...variable, value: 'conversation default', edited: false, full_content: null }
    })
    renderRight({
      ...createCurrentNodeVar(),
      nodeId: 'conversation',
      nodeType: VarInInspectType.conversation,
      var: variable,
    })
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('value'))

    await user.click(
      screen.getByRole('button', {
        name: 'workflowDebug.debug.variableInspect.resetConversationVar',
      }),
    )

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('conversation default'))
    expect(
      screen.queryByRole('button', {
        name: 'workflowDebug.debug.variableInspect.resetConversationVar',
      }),
    ).not.toBeInTheDocument()
    expect(requests.reset).toHaveBeenCalledExactlyOnceWith({
      params: { app_id: 'app-1', variable_id: 'var-1' },
    })
  })
})
