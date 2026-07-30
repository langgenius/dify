import type { ModelItem, ModelProvider } from '../../declarations'
import type { ModelLoadBalancingModalProps } from '../model-load-balancing-modal'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { render } from '@/test/console/render'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelList from '../model-list'

let mockWorkspacePermissionKeys: string[] = [
  'plugin.model_config',
  'credential.manage',
  'credential.use',
]

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }))
})

vi.mock('@/next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const LazyComponent = React.lazy(loader)
    return function DynamicComponent(props: Record<string, unknown>) {
      return React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(LazyComponent, props),
      )
    }
  },
}))

vi.mock('../model-load-balancing-modal', () => ({
  default: ({ model, onClose, onSave, open, provider }: ModelLoadBalancingModalProps) =>
    open ? (
      <div role="dialog" aria-label={`Load balancing for ${model.model}`}>
        <span>{provider.provider}</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          onClick={() => {
            onSave?.(provider.provider)
            onClose?.()
          }}
        >
          Save
        </button>
      </div>
    ) : null,
}))

vi.mock('../model-list-item', () => ({
  default: ({
    model,
    onModifyLoadBalancing,
  }: {
    model: ModelItem
    onModifyLoadBalancing: (model: ModelItem) => void
  }) => (
    <button
      type="button"
      aria-label={`Modify load balancing for ${model.model}`}
      onClick={() => onModifyLoadBalancing(model)}
    >
      {model.model}
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  ManageCustomModelCredentials: () => <div data-testid="manage-credentials" />,
  AddCustomModel: () => <div data-testid="add-custom-model" />,
}))

describe('ModelList', () => {
  const mockProvider = {
    provider: 'test-provider',
    configurate_methods: ['customizableModel'],
  } as unknown as ModelProvider

  const mockModels = [
    { model: 'gpt-4', model_type: 'llm', fetch_from: 'system' },
    { model: 'gpt-3.5', model_type: 'llm', fetch_from: 'system' },
  ] as unknown as ModelItem[]

  const mockOnCollapse = vi.fn()
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = ['plugin.model_config', 'credential.manage', 'credential.use']
  })

  it('should render model count and model items', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    expect(screen.getAllByText(/modelProvider\.modelsNum/).length).toBeGreaterThan(0)
    expect(
      screen.getByRole('button', { name: 'Modify load balancing for gpt-4' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Modify load balancing for gpt-3.5' }),
    ).toBeInTheDocument()
  })

  it('should trigger collapse when collapsed label is clicked', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const countElements = screen.getAllByText(/modelProvider\.modelsNum/)
    fireEvent.click(countElements[1]!)
    expect(mockOnCollapse).toHaveBeenCalled()
  })

  it('should open the selected model and reset the payload after close', async () => {
    const user = userEvent.setup()
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Modify load balancing for gpt-4' }))

    const firstDialog = await screen.findByRole('dialog', {
      name: 'Load balancing for gpt-4',
    })
    expect(within(firstDialog).getByText('test-provider')).toBeInTheDocument()

    await user.click(within(firstDialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Load balancing for gpt-4' }),
      ).not.toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Modify load balancing for gpt-3.5' }))

    expect(
      await screen.findByRole('dialog', { name: 'Load balancing for gpt-3.5' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('dialog', { name: 'Load balancing for gpt-4' }),
    ).not.toBeInTheDocument()
  })

  it('should hide custom model actions without plugin.model_config', () => {
    mockWorkspacePermissionKeys = []
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should hide custom model actions when provider uses predefinedModel only', () => {
    const predefinedProvider = {
      provider: 'test-provider',
      configurate_methods: ['predefinedModel'],
    } as unknown as ModelProvider

    render(
      <ModelList
        provider={predefinedProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should refresh the provider and close after saving load balancing changes', async () => {
    const user = userEvent.setup()
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Modify load balancing for gpt-4' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'Load balancing for gpt-4',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(mockOnChange).toHaveBeenCalledWith('test-provider')
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Load balancing for gpt-4' }),
      ).not.toBeInTheDocument()
    })
  })

  it('should hide custom model actions when provider uses fetchFromRemote only', () => {
    const fetchOnlyProvider = {
      provider: 'test-provider',
      configurate_methods: ['fetchFromRemote'],
    } as unknown as ModelProvider

    render(
      <ModelList
        provider={fetchOnlyProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should show custom model actions when provider is configurable and user can configure models', () => {
    const configurableProvider = {
      provider: 'test-provider',
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
    } as unknown as ModelProvider

    mockWorkspacePermissionKeys = ['plugin.model_config']

    render(
      <ModelList
        provider={configurableProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.getByTestId('manage-credentials'))!.toBeInTheDocument()
    expect(screen.getByTestId('add-custom-model'))!.toBeInTheDocument()
  })

  it('should hide custom model actions when provider is configurable but user cannot configure models', () => {
    const configurableProvider = {
      provider: 'test-provider',
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
    } as unknown as ModelProvider

    mockWorkspacePermissionKeys = []

    render(
      <ModelList
        provider={configurableProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })
})
