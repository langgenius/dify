import type { PluginDeclaration, PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum, PluginSource } from '@/app/components/plugins/types'
import PluginDetailPanel from '../index'

const mockSetDetail = vi.fn()

vi.mock('../store', () => ({
  usePluginStore: () => ({ setDetail: mockSetDetail }),
}))

vi.mock('../detail-header', () => ({
  default: ({
    onUpdate,
    onHide,
  }: {
    onUpdate: (isDelete?: boolean) => void
    onHide: () => void
  }) => (
    <header>
      <button onClick={() => onUpdate()}>Update</button>
      <button onClick={() => onUpdate(true)}>Delete</button>
      <button onClick={onHide}>Close</button>
    </header>
  ),
}))

vi.mock('../action-list', () => ({ default: () => <div>Actions</div> }))
vi.mock('../agent-strategy-list', () => ({ default: () => <div>Agent strategies</div> }))
vi.mock('../endpoint-list', () => ({ default: () => <div>Endpoints</div> }))
vi.mock('../model-list', () => ({ default: () => <div>Models</div> }))
vi.mock('../datasource-action-list', () => ({ default: () => <div>Data sources</div> }))
vi.mock('../subscription-list', () => ({
  SubscriptionList: () => <div>Subscriptions</div>,
}))
vi.mock('../trigger/event-list', () => ({
  TriggerEventsList: () => <div>Trigger events</div>,
}))
vi.mock('../../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div>Readme</div>,
}))

const createPluginDetail = (
  declarationOverrides: Partial<PluginDeclaration> = {},
): PluginDetail => {
  const declaration = {
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
    tool: undefined,
    model: null,
    tags: [],
    agent_strategy: null,
    meta: { version: '1.0.0' },
    trigger: null,
    datasource: null,
    ...declarationOverrides,
  } as unknown as PluginDeclaration

  return {
    id: 'test-plugin-id',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    name: 'Test Plugin',
    plugin_id: 'test-plugin-id',
    plugin_unique_identifier: 'test-plugin-uid',
    declaration,
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
  }
}

describe('PluginDetailPanel', () => {
  const onUpdate = vi.fn()
  const onHide = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing and clears the store when detail is absent', async () => {
    const { container } = render(
      <PluginDetailPanel detail={undefined} onUpdate={onUpdate} onHide={onHide} />,
    )

    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(mockSetDetail).toHaveBeenCalledWith(undefined))
  })

  it('publishes the detail fields consumed by descendants', async () => {
    const detail = createPluginDetail()

    render(<PluginDetailPanel detail={detail} onUpdate={onUpdate} onHide={onHide} />)

    await waitFor(() => {
      expect(mockSetDetail).toHaveBeenCalledWith({
        plugin_id: 'test-plugin-id',
        provider: 'test-plugin-id/test-plugin',
        plugin_unique_identifier: 'test-plugin-uid',
        declaration: detail.declaration,
        name: 'Test Plugin',
        id: 'test-plugin-id',
      })
    })
  })

  it.each([
    ['tool', { tool: {} }, 'Actions'],
    ['agent strategy', { agent_strategy: {} }, 'Agent strategies'],
    ['endpoint', { endpoint: {} }, 'Endpoints'],
    ['model', { model: {} }, 'Models'],
    ['data source', { datasource: {} }, 'Data sources'],
  ] as const)('renders the %s section declared by the plugin', (_, declaration, section) => {
    render(
      <PluginDetailPanel
        detail={createPluginDetail(declaration as Partial<PluginDeclaration>)}
        onUpdate={onUpdate}
        onHide={onHide}
      />,
    )

    expect(screen.getByText(section)).toBeInTheDocument()
    expect(screen.getByText('Readme')).toBeInTheDocument()
  })

  it('renders subscription and event sections for trigger plugins', () => {
    render(
      <PluginDetailPanel
        detail={createPluginDetail({ category: PluginCategoryEnum.trigger })}
        onUpdate={onUpdate}
        onHide={onHide}
      />,
    )

    expect(screen.getByText('Subscriptions')).toBeInTheDocument()
    expect(screen.getByText('Trigger events')).toBeInTheDocument()
  })

  it('updates without closing the panel', () => {
    render(<PluginDetailPanel detail={createPluginDetail()} onUpdate={onUpdate} onHide={onHide} />)

    fireEvent.click(screen.getByRole('button', { name: 'Update' }))

    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onHide).not.toHaveBeenCalled()
  })

  it('closes before notifying consumers when the plugin is deleted', () => {
    render(<PluginDetailPanel detail={createPluginDetail()} onUpdate={onUpdate} onHide={onHide} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onHide).toHaveBeenCalledOnce()
    expect(onUpdate).toHaveBeenCalledOnce()
    expect(onHide.mock.invocationCallOrder[0]!).toBeLessThan(onUpdate.mock.invocationCallOrder[0]!)
  })
})
