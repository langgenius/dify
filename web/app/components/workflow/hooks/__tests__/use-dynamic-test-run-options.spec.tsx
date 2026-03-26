import { renderHook } from '@testing-library/react'
import { BlockEnum } from '../../types'
import { useDynamicTestRunOptions } from '../use-dynamic-test-run-options'

const mockUseTranslation = vi.hoisted(() => vi.fn())
const mockUseNodes = vi.hoisted(() => vi.fn())
const mockUseStore = vi.hoisted(() => vi.fn())
const mockUseAllTriggerPlugins = vi.hoisted(() => vi.fn())
const mockGetWorkflowEntryNode = vi.hoisted(() => vi.fn())

vi.mock('react-i18next', () => ({
  useTranslation: () => mockUseTranslation(),
}))

vi.mock('@/app/components/workflow/store/workflow/use-nodes', () => ({
  __esModule: true,
  default: () => mockUseNodes(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    buildInTools: unknown[]
    customTools: unknown[]
    workflowTools: unknown[]
    mcpTools: unknown[]
  }) => unknown) => mockUseStore(selector),
}))

vi.mock('@/service/use-triggers', () => ({
  useAllTriggerPlugins: () => mockUseAllTriggerPlugins(),
}))

vi.mock('@/app/components/workflow/utils/workflow-entry', () => ({
  getWorkflowEntryNode: (...args: unknown[]) => mockGetWorkflowEntryNode(...args),
}))

describe('useDynamicTestRunOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTranslation.mockReturnValue({
      t: (key: string) => key,
    })
    mockUseStore.mockImplementation((selector: (state: {
      buildInTools: unknown[]
      customTools: unknown[]
      workflowTools: unknown[]
      mcpTools: unknown[]
    }) => unknown) => selector({
      buildInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    }))
    mockUseAllTriggerPlugins.mockReturnValue({
      data: [{
        name: 'plugin-provider',
        icon: '/plugin-icon.png',
      }],
    })
  })

  it('should build user input, trigger options, and a run-all option from workflow nodes', () => {
    mockUseNodes.mockReturnValue([
      {
        id: 'start-1',
        data: { type: BlockEnum.Start, title: 'User Input' },
      },
      {
        id: 'schedule-1',
        data: { type: BlockEnum.TriggerSchedule, title: 'Daily Schedule' },
      },
      {
        id: 'webhook-1',
        data: { type: BlockEnum.TriggerWebhook, title: 'Webhook Trigger' },
      },
      {
        id: 'plugin-1',
        data: {
          type: BlockEnum.TriggerPlugin,
          title: '',
          plugin_name: 'Plugin Trigger',
          provider_id: 'plugin-provider',
        },
      },
    ])

    const { result } = renderHook(() => useDynamicTestRunOptions())

    expect(result.current.userInput).toEqual(expect.objectContaining({
      id: 'start-1',
      type: 'user_input',
      name: 'User Input',
      nodeId: 'start-1',
      enabled: true,
    }))
    expect(result.current.triggers).toEqual([
      expect.objectContaining({
        id: 'schedule-1',
        type: 'schedule',
        name: 'Daily Schedule',
        nodeId: 'schedule-1',
      }),
      expect.objectContaining({
        id: 'webhook-1',
        type: 'webhook',
        name: 'Webhook Trigger',
        nodeId: 'webhook-1',
      }),
      expect.objectContaining({
        id: 'plugin-1',
        type: 'plugin',
        name: 'Plugin Trigger',
        nodeId: 'plugin-1',
      }),
    ])
    expect(result.current.runAll).toEqual(expect.objectContaining({
      id: 'run-all',
      type: 'all',
      relatedNodeIds: ['schedule-1', 'webhook-1', 'plugin-1'],
    }))
  })

  it('should fall back to the workflow entry node and omit run-all when only one trigger exists', () => {
    mockUseNodes.mockReturnValue([
      {
        id: 'webhook-1',
        data: { type: BlockEnum.TriggerWebhook, title: 'Webhook Trigger' },
      },
    ])
    mockGetWorkflowEntryNode.mockReturnValue({
      id: 'fallback-start',
      data: { type: BlockEnum.Start, title: '' },
    })

    const { result } = renderHook(() => useDynamicTestRunOptions())

    expect(result.current.userInput).toEqual(expect.objectContaining({
      id: 'fallback-start',
      type: 'user_input',
      name: 'blocks.start',
      nodeId: 'fallback-start',
    }))
    expect(result.current.triggers).toHaveLength(1)
    expect(result.current.runAll).toBeUndefined()
  })
})
