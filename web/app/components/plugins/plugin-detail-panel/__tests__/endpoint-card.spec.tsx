import type { EndpointListItem, PluginDetail } from '../../types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import EndpointCard from '../endpoint-card'

const mockHandleChange = vi.fn()
const mockEnableEndpoint = vi.fn()
const mockDisableEndpoint = vi.fn()
const mockDeleteEndpoint = vi.fn()
const mockUpdateEndpoint = vi.fn()

// Flags to control whether operations should fail
const failureFlags = {
  enable: false,
  disable: false,
  delete: false,
  update: false,
}

vi.mock('@/service/use-endpoints', () => ({
  useEnableEndpoint: ({ onSuccess, onError }: { onSuccess: () => void, onError: () => void }) => ({
    mutate: (id: string) => {
      mockEnableEndpoint(id)
      if (failureFlags.enable)
        onError()
      else
        onSuccess()
    },
  }),
  useDisableEndpoint: ({ onSuccess, onError }: { onSuccess: () => void, onError: () => void }) => ({
    mutate: (id: string) => {
      mockDisableEndpoint(id)
      if (failureFlags.disable)
        onError()
      else
        onSuccess()
    },
  }),
  useDeleteEndpoint: ({ onSuccess, onError }: { onSuccess: () => void, onError: () => void }) => ({
    mutate: (id: string) => {
      mockDeleteEndpoint(id)
      if (failureFlags.delete)
        onError()
      else
        onSuccess()
    },
  }),
  useUpdateEndpoint: ({ onSuccess, onError }: { onSuccess: () => void, onError: () => void }) => ({
    mutate: (data: unknown) => {
      mockUpdateEndpoint(data)
      if (failureFlags.update)
        onError()
      else
        onSuccess()
    },
  }),
}))

vi.mock('@/app/components/header/indicator', () => ({
  default: ({ color }: { color: string }) => <span data-testid="indicator" data-color={color} />,
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolCredentialToFormSchemas: (schemas: unknown[]) => schemas,
  addDefaultValue: (value: unknown) => value,
}))

vi.mock('../endpoint-modal', () => ({
  default: ({ onCancel, onSaved }: { onCancel: () => void, onSaved: (state: unknown) => void }) => (
    <div data-testid="endpoint-modal">
      <button data-testid="modal-cancel" onClick={onCancel}>Cancel</button>
      <button data-testid="modal-save" onClick={() => onSaved({ name: 'Updated' })}>Save</button>
    </div>
  ),
}))

const mockEndpointData: EndpointListItem = {
  id: 'ep-1',
  name: 'Test Endpoint',
  url: 'https://api.example.com',
  enabled: true,
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  settings: {},
  tenant_id: 'tenant-1',
  plugin_id: 'plugin-1',
  expired_at: '',
  hook_id: 'hook-1',
  declaration: {
    settings: [],
    endpoints: [
      { path: '/api/test', method: 'GET' },
      { path: '/api/hidden', method: 'POST', hidden: true },
    ],
  },
}

const mockPluginDetail: PluginDetail = {
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {} as PluginDetail['declaration'],
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
}

describe('EndpointCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset failure flags
    failureFlags.enable = false
    failureFlags.disable = false
    failureFlags.delete = false
    failureFlags.update = false
    // Mock Toast.notify to prevent toast elements from accumulating in DOM
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
    // Polyfill document.execCommand for copy-to-clipboard in jsdom
    if (typeof document.execCommand !== 'function') {
      document.execCommand = vi.fn().mockReturnValue(true)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render endpoint name', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      expect(screen.getByText('Test Endpoint')).toBeInTheDocument()
    })

    it('should render visible endpoints only', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      expect(screen.getByText('GET')).toBeInTheDocument()
      expect(screen.getByText('https://api.example.com/api/test')).toBeInTheDocument()
      expect(screen.queryByText('POST')).not.toBeInTheDocument()
    })

    it('should show active status when enabled', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      expect(screen.getByText('plugin.detailPanel.serviceOk')).toBeInTheDocument()
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
    })

    it('should show disabled status when not enabled', () => {
      const disabledData = { ...mockEndpointData, enabled: false }
      render(<EndpointCard pluginDetail={mockPluginDetail} data={disabledData} handleChange={mockHandleChange} />)

      expect(screen.getByText('plugin.detailPanel.disabled')).toBeInTheDocument()
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'gray')
    })
  })

  describe('User Interactions', () => {
    it('should show disable confirm when switching off', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))

      expect(screen.getByText('plugin.detailPanel.endpointDisableTip')).toBeInTheDocument()
    })

    it('should call disableEndpoint when confirm disable', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))
      // Click confirm button in the Confirm dialog
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(mockDisableEndpoint).toHaveBeenCalledWith('ep-1')
    })

    it('should show delete confirm when delete clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[1])

      expect(screen.getByText('plugin.detailPanel.endpointDeleteTip')).toBeInTheDocument()
    })

    it('should call deleteEndpoint when confirm delete', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[1])
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(mockDeleteEndpoint).toHaveBeenCalledWith('ep-1')
    })

    it('should show edit modal when edit clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[0])

      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()
    })

    it('should call updateEndpoint when save in modal', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[0])
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockUpdateEndpoint).toHaveBeenCalled()
    })
  })

  describe('Copy Functionality', () => {
    it('should reset copy state after timeout', async () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[2])

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(screen.getByText('Test Endpoint')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty endpoints', () => {
      const dataWithNoEndpoints = {
        ...mockEndpointData,
        declaration: { settings: [], endpoints: [] },
      }
      render(<EndpointCard pluginDetail={mockPluginDetail} data={dataWithNoEndpoints} handleChange={mockHandleChange} />)

      expect(screen.getByText('Test Endpoint')).toBeInTheDocument()
    })

    it('should call handleChange after enable', () => {
      const disabledData = { ...mockEndpointData, enabled: false }
      render(<EndpointCard pluginDetail={mockPluginDetail} data={disabledData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))

      expect(mockHandleChange).toHaveBeenCalled()
    })

    it('should hide disable confirm and revert state when cancel clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))
      expect(screen.getByText('plugin.detailPanel.endpointDisableTip')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      // Confirm should be hidden
      expect(screen.queryByText('plugin.detailPanel.endpointDisableTip')).not.toBeInTheDocument()
    })

    it('should hide delete confirm when cancel clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[1])
      expect(screen.getByText('plugin.detailPanel.endpointDeleteTip')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(screen.queryByText('plugin.detailPanel.endpointDeleteTip')).not.toBeInTheDocument()
    })

    it('should hide edit modal when cancel clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[0])
      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('modal-cancel'))

      expect(screen.queryByTestId('endpoint-modal')).not.toBeInTheDocument()
    })
  })

  describe('Error Handling', () => {
    it('should show error toast when enable fails', () => {
      failureFlags.enable = true
      const disabledData = { ...mockEndpointData, enabled: false }
      render(<EndpointCard pluginDetail={mockPluginDetail} data={disabledData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))

      expect(mockEnableEndpoint).toHaveBeenCalled()
    })

    it('should show error toast when disable fails', () => {
      failureFlags.disable = true
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(mockDisableEndpoint).toHaveBeenCalled()
    })

    it('should show error toast when delete fails', () => {
      failureFlags.delete = true
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[1])
      fireEvent.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(mockDeleteEndpoint).toHaveBeenCalled()
    })

    it('should show error toast when update fails', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      fireEvent.click(allButtons[0])

      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()

      failureFlags.update = true
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockUpdateEndpoint).toHaveBeenCalled()
      expect(mockHandleChange).not.toHaveBeenCalled()
    })
  })
})
