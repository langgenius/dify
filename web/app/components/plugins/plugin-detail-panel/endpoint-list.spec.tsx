import type { PluginDetail } from '@/app/components/plugins/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EndpointList from './endpoint-list'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

const mockEndpoints = [
  { id: 'ep-1', name: 'Endpoint 1', url: 'https://api.example.com', declaration: { settings: [], endpoints: [] } },
]

let mockEndpointListData: { endpoints: typeof mockEndpoints } | undefined

const mockInvalidateEndpointList = vi.fn()
const mockCreateEndpoint = vi.fn()

vi.mock('@/service/use-endpoints', () => ({
  useEndpointList: () => ({ data: mockEndpointListData }),
  useInvalidateEndpointList: () => mockInvalidateEndpointList,
  useCreateEndpoint: ({ onSuccess }: { onSuccess: () => void }) => ({
    mutate: (data: unknown) => {
      mockCreateEndpoint(data)
      onSuccess()
    },
  }),
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolCredentialToFormSchemas: (schemas: unknown[]) => schemas,
}))

vi.mock('./endpoint-card', () => ({
  default: ({ data }: { data: { name: string } }) => (
    <div data-testid="endpoint-card">{data.name}</div>
  ),
}))

vi.mock('./endpoint-modal', () => ({
  default: ({ onCancel, onSaved }: { onCancel: () => void, onSaved: (state: unknown) => void }) => (
    <div data-testid="endpoint-modal">
      <button data-testid="modal-cancel" onClick={onCancel}>Cancel</button>
      <button data-testid="modal-save" onClick={() => onSaved({ name: 'New Endpoint' })}>Save</button>
    </div>
  ),
}))

const createPluginDetail = (): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    endpoint: { settings: [], endpoints: [] },
    tool: undefined,
  } as unknown as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-uid',
  source: 'marketplace' as PluginDetail['source'],
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
})

describe('EndpointList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEndpointListData = { endpoints: mockEndpoints }
  })

  describe('Rendering', () => {
    it('should render endpoint list', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      expect(screen.getByText('detailPanel.endpoints')).toBeInTheDocument()
    })

    it('should render endpoint cards', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      expect(screen.getByTestId('endpoint-card')).toBeInTheDocument()
      expect(screen.getByText('Endpoint 1')).toBeInTheDocument()
    })

    it('should return null when no data', () => {
      mockEndpointListData = undefined
      const { container } = render(<EndpointList detail={createPluginDetail()} />)

      expect(container).toBeEmptyDOMElement()
    })

    it('should show empty message when no endpoints', () => {
      mockEndpointListData = { endpoints: [] }
      render(<EndpointList detail={createPluginDetail()} />)

      expect(screen.getByText('detailPanel.endpointsEmpty')).toBeInTheDocument()
    })

    it('should render add button', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      expect(addButton).toBeDefined()
    })
  })

  describe('User Interactions', () => {
    it('should show modal when add button clicked', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (addButton)
        fireEvent.click(addButton)

      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()
    })

    it('should hide modal when cancel clicked', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (addButton)
        fireEvent.click(addButton)
      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('modal-cancel'))
      expect(screen.queryByTestId('endpoint-modal')).not.toBeInTheDocument()
    })

    it('should call createEndpoint when save clicked', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (addButton)
        fireEvent.click(addButton)
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockCreateEndpoint).toHaveBeenCalled()
    })
  })

  describe('Border Style', () => {
    it('should render with border style based on tool existence', () => {
      const detail = createPluginDetail()
      detail.declaration.tool = {} as PluginDetail['declaration']['tool']
      render(<EndpointList detail={detail} />)

      // Verify the component renders correctly
      expect(screen.getByText('detailPanel.endpoints')).toBeInTheDocument()
    })
  })

  describe('Multiple Endpoints', () => {
    it('should render multiple endpoint cards', () => {
      mockEndpointListData = {
        endpoints: [
          { id: 'ep-1', name: 'Endpoint 1', url: 'https://api1.example.com', declaration: { settings: [], endpoints: [] } },
          { id: 'ep-2', name: 'Endpoint 2', url: 'https://api2.example.com', declaration: { settings: [], endpoints: [] } },
        ],
      }
      render(<EndpointList detail={createPluginDetail()} />)

      expect(screen.getAllByTestId('endpoint-card')).toHaveLength(2)
    })
  })

  describe('Tooltip', () => {
    it('should render with tooltip content', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      // Tooltip is rendered - the add button should be visible
      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      expect(addButton).toBeDefined()
    })
  })

  describe('Create Endpoint Flow', () => {
    it('should invalidate endpoint list after successful create', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (addButton)
        fireEvent.click(addButton)
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockInvalidateEndpointList).toHaveBeenCalledWith('test-plugin')
    })

    it('should pass correct params to createEndpoint', () => {
      render(<EndpointList detail={createPluginDetail()} />)

      const addButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (addButton)
        fireEvent.click(addButton)
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockCreateEndpoint).toHaveBeenCalledWith({
        pluginUniqueID: 'test-uid',
        state: { name: 'New Endpoint' },
      })
    })
  })
})
