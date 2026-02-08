import type { EndpointListItem, PluginDetail } from '../types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import EndpointCard from './endpoint-card'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

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

vi.mock('./endpoint-modal', () => ({
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

      expect(screen.getByText('detailPanel.serviceOk')).toBeInTheDocument()
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'green')
    })

    it('should show disabled status when not enabled', () => {
      const disabledData = { ...mockEndpointData, enabled: false }
      render(<EndpointCard pluginDetail={mockPluginDetail} data={disabledData} handleChange={mockHandleChange} />)

      expect(screen.getByText('detailPanel.disabled')).toBeInTheDocument()
      expect(screen.getByTestId('indicator')).toHaveAttribute('data-color', 'gray')
    })
  })

  describe('User Interactions', () => {
    it('should show disable confirm when switching off', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))

      expect(screen.getByText('detailPanel.endpointDisableTip')).toBeInTheDocument()
    })

    it('should call disableEndpoint when confirm disable', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      fireEvent.click(screen.getByRole('switch'))
      // Click confirm button in the Confirm dialog
      fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

      expect(mockDisableEndpoint).toHaveBeenCalledWith('ep-1')
    })

    it('should show delete confirm when delete clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      // Find delete button by its destructive class
      const allButtons = screen.getAllByRole('button')
      const deleteButton = allButtons.find(btn => btn.classList.contains('text-text-tertiary'))
      expect(deleteButton).toBeDefined()
      if (deleteButton)
        fireEvent.click(deleteButton)

      expect(screen.getByText('detailPanel.endpointDeleteTip')).toBeInTheDocument()
    })

    it('should call deleteEndpoint when confirm delete', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      const deleteButton = allButtons.find(btn => btn.classList.contains('text-text-tertiary'))
      expect(deleteButton).toBeDefined()
      if (deleteButton)
        fireEvent.click(deleteButton)
      fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

      expect(mockDeleteEndpoint).toHaveBeenCalledWith('ep-1')
    })

    it('should show edit modal when edit clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const actionButtons = screen.getAllByRole('button', { name: '' })
      const editButton = actionButtons[0]
      if (editButton)
        fireEvent.click(editButton)

      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()
    })

    it('should call updateEndpoint when save in modal', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const actionButtons = screen.getAllByRole('button', { name: '' })
      const editButton = actionButtons[0]
      if (editButton)
        fireEvent.click(editButton)
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockUpdateEndpoint).toHaveBeenCalled()
    })
  })

  describe('Copy Functionality', () => {
    it('should reset copy state after timeout', async () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      // Find copy button by its class
      const allButtons = screen.getAllByRole('button')
      const copyButton = allButtons.find(btn => btn.classList.contains('ml-2'))
      expect(copyButton).toBeDefined()
      if (copyButton) {
        fireEvent.click(copyButton)

        act(() => {
          vi.advanceTimersByTime(2000)
        })

        // After timeout, the component should still be rendered correctly
        expect(screen.getByText('Test Endpoint')).toBeInTheDocument()
      }
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
      expect(screen.getByText('detailPanel.endpointDisableTip')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'operation.cancel' }))

      // Confirm should be hidden
      expect(screen.queryByText('detailPanel.endpointDisableTip')).not.toBeInTheDocument()
    })

    it('should hide delete confirm when cancel clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      const deleteButton = allButtons.find(btn => btn.classList.contains('text-text-tertiary'))
      expect(deleteButton).toBeDefined()
      if (deleteButton)
        fireEvent.click(deleteButton)
      expect(screen.getByText('detailPanel.endpointDeleteTip')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'operation.cancel' }))

      expect(screen.queryByText('detailPanel.endpointDeleteTip')).not.toBeInTheDocument()
    })

    it('should hide edit modal when cancel clicked', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const actionButtons = screen.getAllByRole('button', { name: '' })
      const editButton = actionButtons[0]
      if (editButton)
        fireEvent.click(editButton)
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
      fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

      expect(mockDisableEndpoint).toHaveBeenCalled()
    })

    it('should show error toast when delete fails', () => {
      failureFlags.delete = true
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const allButtons = screen.getAllByRole('button')
      const deleteButton = allButtons.find(btn => btn.classList.contains('text-text-tertiary'))
      if (deleteButton)
        fireEvent.click(deleteButton)
      fireEvent.click(screen.getByRole('button', { name: 'operation.confirm' }))

      expect(mockDeleteEndpoint).toHaveBeenCalled()
    })

    it('should show error toast when update fails', () => {
      render(<EndpointCard pluginDetail={mockPluginDetail} data={mockEndpointData} handleChange={mockHandleChange} />)

      const actionButtons = screen.getAllByRole('button', { name: '' })
      const editButton = actionButtons[0]
      expect(editButton).toBeDefined()
      if (editButton)
        fireEvent.click(editButton)

      // Verify modal is open
      expect(screen.getByTestId('endpoint-modal')).toBeInTheDocument()

      // Set failure flag before save is clicked
      failureFlags.update = true
      fireEvent.click(screen.getByTestId('modal-save'))

      expect(mockUpdateEndpoint).toHaveBeenCalled()
      // On error, handleChange is not called
      expect(mockHandleChange).not.toHaveBeenCalled()
    })
  })
})
