import type { currentVarType } from '../panel'
import type { VarInInspect } from '@/types/workflow'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { useNodes } from 'reactflow'
import { ModelTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { consoleQuery } from '@/service/console'
import { commonQueryKeys } from '@/service/use-common'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedAppDslVersion, seedSystemFeatures } from '@/test/console/query-data'
import { VarInInspectType } from '@/types/workflow'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, VarType } from '../../types'
import Right from '../right'

const { mockResetConversationVar, mockResetToLastRunVar } = vi.hoisted(() => ({
  mockResetConversationVar: vi.fn(),
  mockResetToLastRunVar: vi.fn(),
}))

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    editInspectVarValue: vi.fn(),
    resetConversationVar: mockResetConversationVar,
    resetToLastRunVar: mockResetToLastRunVar,
  }),
}))

vi.mock('../../hooks/use-tool-icon', () => ({
  useToolIcon: () => '',
}))

vi.mock('../value-content', () => ({
  default: () => <div>Value</div>,
}))

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
  const result = renderWorkflowFlowComponent(
    <Right nodeId="node-1" currentNodeVar={currentNodeVar} handleOpenMenu={handleOpenMenu} />,
    {
      nodes: [],
      edges: [],
      initialStoreState: {
        bottomPanelWidth: options.bottomPanelWidth ?? 560,
      },
    },
  )

  return { ...result, handleOpenMenu }
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url.includes('/default-model?')) return Response.json({ data: null })
    if (
      url.includes('/spec/schema-definitions') ||
      /\/tools\/(?:builtin|api|workflow|mcp)$/.test(url)
    )
      return Response.json([])
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('VariableInspect Right', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    renderRight(createCurrentNodeVar({ edited: true }))

    await user.click(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.reset' }),
    )

    expect(mockResetToLastRunVar).toHaveBeenCalledWith('node-1', 'var-1')
  })

  it('resets an edited conversation variable from its named command', async () => {
    const user = userEvent.setup()

    renderRight(
      createCurrentNodeVar({
        type: VarInInspectType.conversation,
        edited: true,
      }),
    )

    await user.click(
      screen.getByRole('button', {
        name: 'workflowDebug.debug.variableInspect.resetConversationVar',
      }),
    )

    expect(mockResetConversationVar).toHaveBeenCalledWith('var-1')
  })
})

function NodeValue() {
  const nodes = useNodes<{ code?: string; prompt_template?: { text: string }[] }>()
  const node = nodes.find((node) => node.id === 'node-1')
  return (
    <output aria-label="Node source">
      {node?.data.code ?? node?.data.prompt_template?.[0]?.text}
    </output>
  )
}

it.each([BlockEnum.Code, BlockEnum.LLM])(
  'applies generated %s to the inspected node and closes the real dialog',
  async (type) => {
    sessionStorage.clear()
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    seedAccountProfileQuery(client)
    seedSystemFeatures(client)
    seedAppDslVersion(client)
    client.setQueryData(
      consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
        input: { params: { model_type: ModelTypeEnum.textGeneration } },
      }).queryKey,
      { data: [] },
    )
    client.setQueryData(commonQueryKeys.defaultModel(ModelTypeEnum.textGeneration), { data: null })
    client.setQueryData(
      consoleQuery.instructionGenerate.template.post.queryOptions({
        input: { body: { type: type === BlockEnum.Code ? 'code' : 'prompt' } },
      }).queryKey,
      { data: 'Describe a task' },
    )
    sessionStorage.setItem(
      'gen-data-flow-1-node-1-versions',
      JSON.stringify([{ modified: 'Generated source', prompt: 'Existing source' }]),
    )
    const data = {
      type,
      title: 'Node',
      desc: '',
      ...(type === BlockEnum.Code
        ? { code: 'Existing source', code_language: 'python3' }
        : { prompt_template: [{ role: 'system', text: 'Existing source' }] }),
    }
    const user = userEvent.setup()
    const view = renderWorkflowFlowComponent(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter>
          <Right
            nodeId="node-1"
            currentNodeVar={{ ...createCurrentNodeVar(), nodeType: type, nodeData: data }}
            handleOpenMenu={vi.fn()}
          />
          <NodeValue />
        </NuqsTestingAdapter>
      </QueryClientProvider>,
      {
        nodes: [{ id: 'node-1', position: { x: 0, y: 0 }, data }],
        edges: [],
        hooksStoreProps: {
          configsMap: { flowId: 'flow-1', flowType: 'appFlow', fileSettings: { enabled: false } },
          doSyncWorkflowDraft: vi.fn(),
        },
      },
    )
    try {
      await user.click(
        screen.getByRole('button', { name: 'appGeneration.generate.optimizePromptTooltip' }),
      )
      await user.click(await screen.findByRole('button', { name: 'appGeneration.generate.apply' }))
      expect(screen.getByLabelText('Node source')).toHaveTextContent('Existing source')
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'common.operation.confirm',
        }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.getByLabelText('Node source')).toHaveTextContent('Generated source')
    } finally {
      view.unmount()
      client.clear()
    }
  },
)
