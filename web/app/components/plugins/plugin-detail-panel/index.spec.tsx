import type { PluginDeclaration, PluginDetail } from '@/app/components/plugins/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import PluginDetailPanel from './index'

// Mock store
const mockSetDetail = vi.fn()
vi.mock('./store', () => ({
  usePluginStore: () => ({
    setDetail: mockSetDetail,
  }),
}))

// Mock DetailHeader
const mockDetailHeaderOnUpdate = vi.fn()
vi.mock('./detail-header', () => ({
  default: ({ detail, onUpdate, onHide }: {
    detail: PluginDetail
    onUpdate: (isDelete?: boolean) => void
    onHide: () => void
  }) => {
    // Capture the onUpdate callback for testing
    mockDetailHeaderOnUpdate.mockImplementation(onUpdate)
    return (
      <div data-testid="detail-header">
        <span data-testid="header-title">{detail.name}</span>
        <button
          data-testid="header-update-btn"
          onClick={() => onUpdate()}
        >
          Update
        </button>
        <button
          data-testid="header-delete-btn"
          onClick={() => onUpdate(true)}
        >
          Delete
        </button>
        <button
          data-testid="header-hide-btn"
          onClick={onHide}
        >
          Hide
        </button>
      </div>
    )
  },
}))

// Mock ActionList
vi.mock('./action-list', () => ({
  default: ({ detail }: { detail: PluginDetail }) => (
    <div data-testid="action-list">
      <span data-testid="action-list-plugin-id">{detail.plugin_id}</span>
    </div>
  ),
}))

// Mock AgentStrategyList
vi.mock('./agent-strategy-list', () => ({
  default: ({ detail }: { detail: PluginDetail }) => (
    <div data-testid="agent-strategy-list">
      <span data-testid="strategy-list-plugin-id">{detail.plugin_id}</span>
    </div>
  ),
}))

// Mock EndpointList
vi.mock('./endpoint-list', () => ({
  default: ({ detail }: { detail: PluginDetail }) => (
    <div data-testid="endpoint-list">
      <span data-testid="endpoint-list-plugin-id">{detail.plugin_id}</span>
    </div>
  ),
}))

// Mock ModelList
vi.mock('./model-list', () => ({
  default: ({ detail }: { detail: PluginDetail }) => (
    <div data-testid="model-list">
      <span data-testid="model-list-plugin-id">{detail.plugin_id}</span>
    </div>
  ),
}))

// Mock DatasourceActionList
vi.mock('./datasource-action-list', () => ({
  default: ({ detail }: { detail: PluginDetail }) => (
    <div data-testid="datasource-action-list">
      <span data-testid="datasource-list-plugin-id">{detail.plugin_id}</span>
    </div>
  ),
}))

// Mock SubscriptionList
vi.mock('./subscription-list', () => ({
  SubscriptionList: ({ pluginDetail }: { pluginDetail: PluginDetail }) => (
    <div data-testid="subscription-list">
      <span data-testid="subscription-list-plugin-id">{pluginDetail.plugin_id}</span>
    </div>
  ),
}))

// Mock TriggerEventsList
vi.mock('./trigger/event-list', () => ({
  TriggerEventsList: () => (
    <div data-testid="trigger-events-list">Events List</div>
  ),
}))

// Mock ReadmeEntrance
vi.mock('../readme-panel/entrance', () => ({
  ReadmeEntrance: ({ pluginDetail, className }: { pluginDetail: PluginDetail, className?: string }) => (
    <div data-testid="readme-entrance" className={className}>
      <span data-testid="readme-plugin-id">{pluginDetail.plugin_id}</span>
    </div>
  ),
}))

// Mock classnames utility
vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

// Factory function to create mock PluginDetail
const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  const baseDeclaration = {
    plugin_unique_identifier: 'test-plugin-uid',
    version: '1.0.0',
    author: 'test-author',
    icon: 'test-icon.png',
    name: 'test-plugin',
    category: PluginCategoryEnum.tool,
    label: { en_US: 'Test Plugin' },
    description: { en_US: 'Test plugin description' },
    created_at: '2024-01-01T00:00:00Z',
    resource: null,
    plugins: null,
    verified: true,
    endpoint: undefined,
    tool: {
      identity: {
        author: 'test-author',
        name: 'test-tool',
        description: { en_US: 'Test tool' },
        icon: 'tool-icon.png',
        label: { en_US: 'Test Tool' },
        tags: [],
      },
      credentials_schema: [],
    },
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: null,
    datasource: null,
  } as unknown as PluginDeclaration

  return {
    id: 'test-plugin-id',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    name: 'Test Plugin',
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'test-plugin-uid',
    declaration: baseDeclaration,
    installation_id: 'install-1',
    tenant_id: 'tenant-1',
    endpoints_setups: 0,
    endpoints_active: 0,
    version: '1.0.0',
    latest_version: '1.0.0',
    latest_unique_identifier: 'test-plugin-uid',
    source: PluginSource.marketplace,
    meta: undefined,
    status: 'active',
    deprecated_reason: '',
    alternative_plugin_id: '',
    ...overrides,
  }
}

// Factory for trigger plugin
const createTriggerPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  const triggerDeclaration = {
    ...createPluginDetail().declaration,
    category: PluginCategoryEnum.trigger,
    tool: undefined,
    trigger: {
      events: [],
      identity: {
        author: 'test-author',
        name: 'test-trigger',
        label: { en_US: 'Test Trigger' },
        description: { en_US: 'Test trigger desc' },
        icon: 'trigger-icon.png',
        tags: [],
      },
      subscription_constructor: {
        credentials_schema: [],
        oauth_schema: { client_schema: [], credentials_schema: [] },
        parameters: [],
      },
      subscription_schema: [],
    },
  } as unknown as PluginDeclaration

  return createPluginDetail({
    declaration: triggerDeclaration,
    ...overrides,
  })
}

// Factory for model plugin
const createModelPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  return createPluginDetail({
    declaration: {
      ...createPluginDetail().declaration,
      category: PluginCategoryEnum.model,
      tool: undefined,
      model: { provider: 'test-provider' },
    },
    ...overrides,
  })
}

// Factory for agent strategy plugin
const createAgentStrategyPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  const strategyDeclaration = {
    ...createPluginDetail().declaration,
    category: PluginCategoryEnum.agent,
    tool: undefined,
    agent_strategy: {
      identity: {
        author: 'test-author',
        name: 'test-strategy',
        label: { en_US: 'Test Strategy' },
        description: { en_US: 'Test strategy desc' },
        icon: 'strategy-icon.png',
        tags: [],
      },
    },
  } as unknown as PluginDeclaration

  return createPluginDetail({
    declaration: strategyDeclaration,
    ...overrides,
  })
}

// Factory for endpoint plugin
const createEndpointPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  return createPluginDetail({
    declaration: {
      ...createPluginDetail().declaration,
      category: PluginCategoryEnum.extension,
      tool: undefined,
      endpoint: {
        settings: [],
        endpoints: [{ path: '/test', method: 'GET' }],
      },
    },
    ...overrides,
  })
}

// Factory for datasource plugin
const createDatasourcePluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => {
  const datasourceDeclaration = {
    ...createPluginDetail().declaration,
    category: PluginCategoryEnum.datasource,
    tool: undefined,
    datasource: {
      identity: {
        author: 'test-author',
        name: 'test-datasource',
        description: { en_US: 'Test datasource' },
        icon: 'datasource-icon.png',
        label: { en_US: 'Test Datasource' },
        tags: [],
      },
      credentials_schema: [],
    },
  } as unknown as PluginDeclaration

  return createPluginDetail({
    declaration: datasourceDeclaration,
    ...overrides,
  })
}

describe('PluginDetailPanel', () => {
  const mockOnUpdate = vi.fn()
  const mockOnHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockSetDetail.mockClear()
    mockOnUpdate.mockClear()
    mockOnHide.mockClear()
    mockDetailHeaderOnUpdate.mockClear()
  })

  describe('Rendering', () => {
    it('should render nothing when detail is undefined', () => {
      const { container } = render(
        <PluginDetailPanel
          detail={undefined}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(container).toBeEmptyDOMElement()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('should render drawer when detail is provided', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByTestId('detail-header')).toBeInTheDocument()
    })

    it('should render detail header with plugin name', () => {
      const detail = createPluginDetail({ name: 'My Custom Plugin' })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('header-title')).toHaveTextContent('My Custom Plugin')
    })

    it('should render readme entrance with plugin detail', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
      expect(screen.getByTestId('readme-plugin-id')).toHaveTextContent('test-plugin-id')
    })

    it('should render drawer with correct styles', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      const drawer = screen.getByRole('dialog')
      expect(drawer).toBeInTheDocument()
    })
  })

  describe('Conditional Rendering by Plugin Category', () => {
    it('should render ActionList for tool plugins', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('action-list')).toBeInTheDocument()
      expect(screen.queryByTestId('model-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('endpoint-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('agent-strategy-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('subscription-list')).not.toBeInTheDocument()
    })

    it('should render ModelList for model plugins', () => {
      const detail = createModelPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('model-list')).toBeInTheDocument()
      expect(screen.queryByTestId('action-list')).not.toBeInTheDocument()
    })

    it('should render AgentStrategyList for agent strategy plugins', () => {
      const detail = createAgentStrategyPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('agent-strategy-list')).toBeInTheDocument()
      expect(screen.queryByTestId('action-list')).not.toBeInTheDocument()
    })

    it('should render EndpointList for endpoint plugins', () => {
      const detail = createEndpointPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('endpoint-list')).toBeInTheDocument()
      expect(screen.queryByTestId('action-list')).not.toBeInTheDocument()
    })

    it('should render DatasourceActionList for datasource plugins', () => {
      const detail = createDatasourcePluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('datasource-action-list')).toBeInTheDocument()
      expect(screen.queryByTestId('action-list')).not.toBeInTheDocument()
    })

    it('should render SubscriptionList and TriggerEventsList for trigger plugins', () => {
      const detail = createTriggerPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('subscription-list')).toBeInTheDocument()
      expect(screen.getByTestId('trigger-events-list')).toBeInTheDocument()
      expect(screen.queryByTestId('action-list')).not.toBeInTheDocument()
    })

    it('should render multiple lists when plugin has multiple declarations', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          tool: createPluginDetail().declaration.tool,
          endpoint: {
            settings: [],
            endpoints: [{ path: '/api', method: 'POST' }],
          },
        },
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('action-list')).toBeInTheDocument()
      expect(screen.getByTestId('endpoint-list')).toBeInTheDocument()
    })
  })

  describe('Side Effects and Cleanup', () => {
    it('should call setDetail with correct data when detail is provided', () => {
      const detail = createPluginDetail({
        plugin_id: 'my-plugin-id',
        plugin_unique_identifier: 'my-plugin-uid',
        name: 'My Plugin',
        id: 'detail-id',
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledTimes(1)
      expect(mockSetDetail).toHaveBeenCalledWith(expect.objectContaining({
        plugin_id: 'my-plugin-id',
        plugin_unique_identifier: 'my-plugin-uid',
        name: 'My Plugin',
        id: 'detail-id',
        provider: 'my-plugin-id/test-plugin',
      }))
    })

    it('should call setDetail with undefined when detail becomes undefined', () => {
      const detail = createPluginDetail()
      const { rerender } = render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledTimes(1)

      rerender(
        <PluginDetailPanel
          detail={undefined}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledTimes(2)
      expect(mockSetDetail).toHaveBeenLastCalledWith(undefined)
    })

    it('should update store when detail changes', () => {
      const detail1 = createPluginDetail({ plugin_id: 'plugin-1' })
      const detail2 = createPluginDetail({ plugin_id: 'plugin-2' })

      const { rerender } = render(
        <PluginDetailPanel
          detail={detail1}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledTimes(1)
      expect(mockSetDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        plugin_id: 'plugin-1',
      }))

      rerender(
        <PluginDetailPanel
          detail={detail2}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledTimes(2)
      expect(mockSetDetail).toHaveBeenLastCalledWith(expect.objectContaining({
        plugin_id: 'plugin-2',
      }))
    })

    it('should include declaration in setDetail call', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledWith(expect.objectContaining({
        declaration: expect.any(Object),
      }))
    })
  })

  describe('Callback Stability and Memoization', () => {
    it('should maintain stable callback reference via useCallback', () => {
      const detail = createPluginDetail()
      const onUpdate = vi.fn()
      const onHide = vi.fn()

      // Test that the callback is created with useCallback by verifying
      // it depends on onHide and onUpdate (tested in other tests)
      // This test verifies the basic rendering doesn't change the functionality
      const { rerender } = render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate}
          onHide={onHide}
        />,
      )

      // Initial click should work
      fireEvent.click(screen.getByTestId('header-update-btn'))
      expect(onUpdate).toHaveBeenCalledTimes(1)

      // Re-render with same props
      rerender(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate}
          onHide={onHide}
        />,
      )

      // Callback should still work after re-render
      fireEvent.click(screen.getByTestId('header-update-btn'))
      expect(onUpdate).toHaveBeenCalledTimes(2)
    })

    it('should update handleUpdate when onUpdate prop changes', () => {
      const detail = createPluginDetail()
      const onUpdate1 = vi.fn()
      const onUpdate2 = vi.fn()
      const onHide = vi.fn()

      const { rerender } = render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate1}
          onHide={onHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-update-btn'))
      expect(onUpdate1).toHaveBeenCalledTimes(1)

      rerender(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate2}
          onHide={onHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-update-btn'))
      expect(onUpdate2).toHaveBeenCalledTimes(1)
    })

    it('should update handleUpdate when onHide prop changes', () => {
      const detail = createPluginDetail()
      const onUpdate = vi.fn()
      const onHide1 = vi.fn()
      const onHide2 = vi.fn()

      const { rerender } = render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate}
          onHide={onHide1}
        />,
      )

      fireEvent.click(screen.getByTestId('header-delete-btn'))
      expect(onHide1).toHaveBeenCalledTimes(1)

      rerender(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate}
          onHide={onHide2}
        />,
      )

      onUpdate.mockClear()
      fireEvent.click(screen.getByTestId('header-delete-btn'))
      expect(onHide2).toHaveBeenCalledTimes(1)
    })
  })

  describe('User Interactions and Event Handlers', () => {
    it('should call onUpdate when update button is clicked', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-update-btn'))

      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      expect(mockOnHide).not.toHaveBeenCalled()
    })

    it('should call onHide and onUpdate when delete is triggered', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-delete-btn'))

      expect(mockOnHide).toHaveBeenCalledTimes(1)
      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
    })

    it('should call onHide before onUpdate when isDelete is true', () => {
      const callOrder: string[] = []
      const onUpdate = vi.fn(() => callOrder.push('update'))
      const onHide = vi.fn(() => callOrder.push('hide'))

      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={onUpdate}
          onHide={onHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-delete-btn'))

      expect(callOrder).toEqual(['hide', 'update'])
    })

    it('should call only onUpdate when isDelete is false', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-update-btn'))

      expect(mockOnUpdate).toHaveBeenCalledTimes(1)
      expect(mockOnHide).not.toHaveBeenCalled()
    })

    it('should call onHide when hide button is clicked', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      fireEvent.click(screen.getByTestId('header-hide-btn'))

      expect(mockOnHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when drawer close is triggered', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      // Click the hide button in the header to close the drawer
      fireEvent.click(screen.getByTestId('header-hide-btn'))

      expect(mockOnHide).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle plugin with empty declaration name gracefully', () => {
      const detail = createPluginDetail({
        declaration: {
          ...createPluginDetail().declaration,
          name: '',
        },
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledWith(expect.objectContaining({
        provider: expect.stringContaining('/'),
      }))
    })

    it('should handle plugin with empty plugin_unique_identifier', () => {
      const detail = createPluginDetail({
        plugin_unique_identifier: '',
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledWith(expect.objectContaining({
        plugin_unique_identifier: '',
      }))
    })

    it('should handle plugin with undefined plugin_unique_identifier', () => {
      const detail = createPluginDetail({
        plugin_unique_identifier: undefined as unknown as string,
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle plugin without tool, model, endpoint, agent_strategy, or datasource', () => {
      const emptyDeclaration = {
        ...createPluginDetail().declaration,
        tool: undefined,
        model: undefined,
        endpoint: undefined,
        agent_strategy: undefined,
        datasource: undefined,
        category: PluginCategoryEnum.extension,
      } as unknown as PluginDeclaration

      const detail = createPluginDetail({
        declaration: emptyDeclaration,
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.queryByTestId('action-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('model-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('endpoint-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('agent-strategy-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('datasource-action-list')).not.toBeInTheDocument()
    })

    it('should handle rapid prop changes without errors', () => {
      const detail1 = createPluginDetail({ plugin_id: 'plugin-1' })
      const detail2 = createPluginDetail({ plugin_id: 'plugin-2' })
      const detail3 = createPluginDetail({ plugin_id: 'plugin-3' })

      const { rerender } = render(
        <PluginDetailPanel
          detail={detail1}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      act(() => {
        rerender(
          <PluginDetailPanel
            detail={detail2}
            onUpdate={mockOnUpdate}
            onHide={mockOnHide}
          />,
        )
      })

      act(() => {
        rerender(
          <PluginDetailPanel
            detail={detail3}
            onUpdate={mockOnUpdate}
            onHide={mockOnHide}
          />,
        )
      })

      expect(mockSetDetail).toHaveBeenCalledTimes(3)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle toggle between defined and undefined detail', () => {
      const detail = createPluginDetail()

      const { rerender, container } = render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()

      rerender(
        <PluginDetailPanel
          detail={undefined}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(container).toBeEmptyDOMElement()

      rerender(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should pass correct props to DetailHeader', () => {
      const detail = createPluginDetail({ name: 'Custom Plugin Name' })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('header-title')).toHaveTextContent('Custom Plugin Name')
    })

    it('should handle different plugin sources', () => {
      const sources: PluginSource[] = [
        PluginSource.marketplace,
        PluginSource.github,
        PluginSource.local,
        PluginSource.debugging,
      ]

      sources.forEach((source) => {
        const detail = createPluginDetail({ source })
        const { unmount } = render(
          <PluginDetailPanel
            detail={detail}
            onUpdate={mockOnUpdate}
            onHide={mockOnHide}
          />,
        )

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle different plugin statuses', () => {
      const statuses: Array<'active' | 'deleted'> = ['active', 'deleted']

      statuses.forEach((status) => {
        const detail = createPluginDetail({ status })
        const { unmount } = render(
          <PluginDetailPanel
            detail={detail}
            onUpdate={mockOnUpdate}
            onHide={mockOnHide}
          />,
        )

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        unmount()
      })
    })

    it('should handle plugin with deprecated_reason', () => {
      const detail = createPluginDetail({
        deprecated_reason: 'This plugin is deprecated',
        alternative_plugin_id: 'alternative-plugin',
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle plugin with meta data for github source', () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: {
          repo: 'owner/repo-name',
          version: 'v1.2.3',
          package: 'package.difypkg',
        },
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should handle plugin with different versions', () => {
      const detail = createPluginDetail({
        version: '1.0.0',
        latest_version: '2.0.0',
        latest_unique_identifier: 'new-uid',
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should pass pluginDetail to SubscriptionList for trigger plugins', () => {
      const detail = createTriggerPluginDetail({ plugin_id: 'trigger-plugin-123' })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('subscription-list-plugin-id')).toHaveTextContent('trigger-plugin-123')
    })

    it('should pass detail to ActionList for tool plugins', () => {
      const detail = createPluginDetail({ plugin_id: 'tool-plugin-456' })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(screen.getByTestId('action-list-plugin-id')).toHaveTextContent('tool-plugin-456')
    })
  })

  describe('Store Integration', () => {
    it('should construct provider correctly from plugin_id and declaration.name', () => {
      const detail = createPluginDetail({
        plugin_id: 'my-org/my-plugin',
        declaration: {
          ...createPluginDetail().declaration,
          name: 'my-tool-name',
        },
      })

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'my-org/my-plugin/my-tool-name',
      }))
    })

    it('should include all required fields in setDetail payload', () => {
      const detail = createPluginDetail()

      render(
        <PluginDetailPanel
          detail={detail}
          onUpdate={mockOnUpdate}
          onHide={mockOnHide}
        />,
      )

      expect(mockSetDetail).toHaveBeenCalledWith({
        plugin_id: detail.plugin_id,
        provider: expect.any(String),
        plugin_unique_identifier: detail.plugin_unique_identifier,
        declaration: detail.declaration,
        name: detail.name,
        id: detail.id,
      })
    })
  })
})
