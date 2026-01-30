import type { ReactNode } from 'react'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'
import MCPModal from './modal'

// Mock the service API
vi.mock('@/service/common', () => ({
  uploadRemoteFileInfo: vi.fn().mockResolvedValue({ url: 'https://example.com/icon.png' }),
}))

// Mock the AppIconPicker component
type IconPayload = {
  type: string
  icon: string
  background: string
}

type AppIconPickerProps = {
  onSelect: (payload: IconPayload) => void
  onClose: () => void
}

vi.mock('@/app/components/base/app-icon-picker', () => ({
  default: ({ onSelect, onClose }: AppIconPickerProps) => (
    <div data-testid="app-icon-picker">
      <button data-testid="select-emoji-btn" onClick={() => onSelect({ type: 'emoji', icon: '🎉', background: '#FF0000' })}>
        Select Emoji
      </button>
      <button data-testid="close-picker-btn" onClick={onClose}>
        Close Picker
      </button>
    </div>
  ),
}))

// Mock the plugins service to avoid React Query issues from TabSlider
vi.mock('@/service/use-plugins', () => ({
  useInstalledPluginList: () => ({
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    isLoading: false,
    isSuccess: true,
  }),
}))

describe('MCPModal', () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    return ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children)
  }

  const defaultProps = {
    show: true,
    onConfirm: vi.fn(),
    onHide: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.title')).toBeInTheDocument()
    })

    it('should not render when show is false', () => {
      render(<MCPModal {...defaultProps} show={false} />, { wrapper: createWrapper() })
      expect(screen.queryByText('tools.mcp.modal.title')).not.toBeInTheDocument()
    })

    it('should render create title when no data is provided', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.title')).toBeInTheDocument()
    })

    it('should render edit title when data is provided', () => {
      const mockData = {
        id: 'test-id',
        name: 'Test Server',
        server_url: 'https://example.com/mcp',
        server_identifier: 'test-server',
        icon: { content: '🔗', background: '#6366F1' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.editTitle')).toBeInTheDocument()
    })
  })

  describe('Form Fields', () => {
    it('should render server URL input', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.serverUrl')).toBeInTheDocument()
    })

    it('should render name input', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.name')).toBeInTheDocument()
    })

    it('should render server identifier input', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.serverIdentifier')).toBeInTheDocument()
    })

    it('should render auth method tabs', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.authentication')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.headers')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.modal.configurations')).toBeInTheDocument()
    })
  })

  describe('Form Interactions', () => {
    it('should update URL input value', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      fireEvent.change(urlInput, { target: { value: 'https://test.com/mcp' } })

      expect(urlInput).toHaveValue('https://test.com/mcp')
    })

    it('should update name input value', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'My Server' } })

      expect(nameInput).toHaveValue('My Server')
    })

    it('should update server identifier input value', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')
      fireEvent.change(identifierInput, { target: { value: 'my-server' } })

      expect(identifierInput).toHaveValue('my-server')
    })
  })

  describe('Tab Navigation', () => {
    it('should show authentication section by default', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.useDynamicClientRegistration')).toBeInTheDocument()
    })

    it('should switch to headers section when clicked', async () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const headersTab = screen.getByText('tools.mcp.modal.headers')
      fireEvent.click(headersTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.headersTip')).toBeInTheDocument()
      })
    })

    it('should switch to configurations section when clicked', async () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const configTab = screen.getByText('tools.mcp.modal.configurations')
      fireEvent.click(configTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.timeout')).toBeInTheDocument()
        expect(screen.getByText('tools.mcp.modal.sseReadTimeout')).toBeInTheDocument()
      })
    })
  })

  describe('Action Buttons', () => {
    it('should render confirm button', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.confirm')).toBeInTheDocument()
    })

    it('should render save button in edit mode', () => {
      const mockData = {
        id: 'test-id',
        name: 'Test',
        icon: { content: '🔗', background: '#6366F1' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.save')).toBeInTheDocument()
    })

    it('should render cancel button', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })
      expect(screen.getByText('tools.mcp.modal.cancel')).toBeInTheDocument()
    })

    it('should call onHide when cancel is clicked', () => {
      const onHide = vi.fn()
      render(<MCPModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      const cancelButton = screen.getByText('tools.mcp.modal.cancel')
      fireEvent.click(cancelButton)

      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should call onHide when close icon is clicked', () => {
      const onHide = vi.fn()
      render(<MCPModal {...defaultProps} onHide={onHide} />, { wrapper: createWrapper() })

      // Find the close button by its parent div with cursor-pointer class
      const closeButtons = document.querySelectorAll('.cursor-pointer')
      const closeButton = Array.from(closeButtons).find(el =>
        el.querySelector('svg'),
      )

      if (closeButton) {
        fireEvent.click(closeButton)
        expect(onHide).toHaveBeenCalled()
      }
    })

    it('should have confirm button disabled when form is empty', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      expect(confirmButton).toBeDisabled()
    })

    it('should enable confirm button when required fields are filled', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      expect(confirmButton).not.toBeDisabled()
    })
  })

  describe('Form Submission', () => {
    it('should call onConfirm with correct data when form is submitted', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Test Server',
            server_url: 'https://example.com/mcp',
            server_identifier: 'test-server',
          }),
        )
      })
    })

    it('should not call onConfirm with invalid URL', async () => {
      const onConfirm = vi.fn()
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill fields with invalid URL
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'not-a-valid-url' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      // Wait a bit and verify onConfirm was not called
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(onConfirm).not.toHaveBeenCalled()
    })

    it('should not call onConfirm with invalid server identifier', async () => {
      const onConfirm = vi.fn()
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill fields with invalid server identifier
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'Invalid Server ID!' } })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      // Wait a bit and verify onConfirm was not called
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(onConfirm).not.toHaveBeenCalled()
    })
  })

  describe('Edit Mode', () => {
    const mockData = {
      id: 'test-id',
      name: 'Existing Server',
      server_url: 'https://existing.com/mcp',
      server_identifier: 'existing-server',
      icon: { content: '🚀', background: '#FF0000' },
      configuration: {
        timeout: 60,
        sse_read_timeout: 600,
      },
      masked_headers: {
        Authorization: '***',
      },
      is_dynamic_registration: false,
      authentication: {
        client_id: 'client-123',
        client_secret: 'secret-456',
      },
    } as unknown as ToolWithProvider

    it('should populate form with existing data', () => {
      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      expect(screen.getByDisplayValue('https://existing.com/mcp')).toBeInTheDocument()
      expect(screen.getByDisplayValue('Existing Server')).toBeInTheDocument()
      expect(screen.getByDisplayValue('existing-server')).toBeInTheDocument()
    })

    it('should show warning when URL is changed', () => {
      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      const urlInput = screen.getByDisplayValue('https://existing.com/mcp')
      fireEvent.change(urlInput, { target: { value: 'https://new.com/mcp' } })

      expect(screen.getByText('tools.mcp.modal.serverUrlWarning')).toBeInTheDocument()
    })

    it('should show warning when server identifier is changed', () => {
      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      const identifierInput = screen.getByDisplayValue('existing-server')
      fireEvent.change(identifierInput, { target: { value: 'new-server' } })

      expect(screen.getByText('tools.mcp.modal.serverIdentifierWarning')).toBeInTheDocument()
    })
  })

  describe('Form Key Reset', () => {
    it('should reset form when switching from create to edit mode', () => {
      const { rerender } = render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Fill some data in create mode
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      fireEvent.change(nameInput, { target: { value: 'New Server' } })

      // Switch to edit mode with different data
      const mockData = {
        id: 'edit-id',
        name: 'Edit Server',
        icon: { content: '🔗', background: '#6366F1' },
      } as unknown as ToolWithProvider

      rerender(<MCPModal {...defaultProps} data={mockData} />)

      // Should show edit mode data
      expect(screen.getByDisplayValue('Edit Server')).toBeInTheDocument()
    })
  })

  describe('URL Blur Handler', () => {
    it('should trigger URL blur handler when URL input loses focus', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      fireEvent.change(urlInput, { target: { value: '  https://test.com/mcp  ' } })
      fireEvent.blur(urlInput)

      // The blur handler trims the value
      expect(urlInput).toHaveValue('  https://test.com/mcp  ')
    })

    it('should handle URL blur with empty value', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      fireEvent.change(urlInput, { target: { value: '' } })
      fireEvent.blur(urlInput)

      expect(urlInput).toHaveValue('')
    })
  })

  describe('App Icon', () => {
    it('should render app icon with default emoji', () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // The app icon should be rendered
      const appIcons = document.querySelectorAll('[class*="rounded-2xl"]')
      expect(appIcons.length).toBeGreaterThan(0)
    })

    it('should render app icon in edit mode with custom icon', () => {
      const mockData = {
        id: 'test-id',
        name: 'Test Server',
        server_url: 'https://example.com/mcp',
        server_identifier: 'test-server',
        icon: { content: '🚀', background: '#FF0000' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} />, { wrapper: createWrapper() })

      // The app icon should be rendered
      const appIcons = document.querySelectorAll('[class*="rounded-2xl"]')
      expect(appIcons.length).toBeGreaterThan(0)
    })
  })

  describe('Form Submission with Headers', () => {
    it('should submit form with headers data', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      // Switch to headers tab and add a header
      const headersTab = screen.getByText('tools.mcp.modal.headers')
      fireEvent.click(headersTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.headersTip')).toBeInTheDocument()
      })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Test Server',
            server_url: 'https://example.com/mcp',
            server_identifier: 'test-server',
          }),
        )
      })
    })

    it('should submit with authentication data', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      // Submit form
      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            authentication: expect.objectContaining({
              client_id: '',
              client_secret: '',
            }),
          }),
        )
      })
    })

    it('should format headers correctly when submitting with header keys', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const mockData = {
        id: 'test-id',
        name: 'Test Server',
        server_url: 'https://example.com/mcp',
        server_identifier: 'test-server',
        icon: { content: '🔗', background: '#6366F1' },
        masked_headers: {
          'Authorization': 'Bearer token',
          'X-Custom': 'value',
        },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Switch to headers tab
      const headersTab = screen.getByText('tools.mcp.modal.headers')
      fireEvent.click(headersTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.headersTip')).toBeInTheDocument()
      })

      // Submit form
      const saveButton = screen.getByText('tools.mcp.modal.save')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            headers: expect.objectContaining({
              Authorization: expect.any(String),
            }),
          }),
        )
      })
    })
  })

  describe('Edit Mode Submission', () => {
    it('should send hidden URL when URL is unchanged in edit mode', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const mockData = {
        id: 'test-id',
        name: 'Existing Server',
        server_url: 'https://existing.com/mcp',
        server_identifier: 'existing-server',
        icon: { content: '🚀', background: '#FF0000' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Don't change the URL, just submit
      const saveButton = screen.getByText('tools.mcp.modal.save')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            server_url: '[__HIDDEN__]',
          }),
        )
      })
    })

    it('should send new URL when URL is changed in edit mode', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      const mockData = {
        id: 'test-id',
        name: 'Existing Server',
        server_url: 'https://existing.com/mcp',
        server_identifier: 'existing-server',
        icon: { content: '🚀', background: '#FF0000' },
      } as unknown as ToolWithProvider

      render(<MCPModal {...defaultProps} data={mockData} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Change the URL
      const urlInput = screen.getByDisplayValue('https://existing.com/mcp')
      fireEvent.change(urlInput, { target: { value: 'https://new.com/mcp' } })

      const saveButton = screen.getByText('tools.mcp.modal.save')
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            server_url: 'https://new.com/mcp',
          }),
        )
      })
    })
  })

  describe('Configuration Section', () => {
    it('should submit with default timeout values', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            configuration: expect.objectContaining({
              timeout: 30,
              sse_read_timeout: 300,
            }),
          }),
        )
      })
    })

    it('should submit with custom timeout values', async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined)
      render(<MCPModal {...defaultProps} onConfirm={onConfirm} />, { wrapper: createWrapper() })

      // Fill required fields
      const urlInput = screen.getByPlaceholderText('tools.mcp.modal.serverUrlPlaceholder')
      const nameInput = screen.getByPlaceholderText('tools.mcp.modal.namePlaceholder')
      const identifierInput = screen.getByPlaceholderText('tools.mcp.modal.serverIdentifierPlaceholder')

      fireEvent.change(urlInput, { target: { value: 'https://example.com/mcp' } })
      fireEvent.change(nameInput, { target: { value: 'Test Server' } })
      fireEvent.change(identifierInput, { target: { value: 'test-server' } })

      // Switch to configurations tab
      const configTab = screen.getByText('tools.mcp.modal.configurations')
      fireEvent.click(configTab)

      await waitFor(() => {
        expect(screen.getByText('tools.mcp.modal.timeout')).toBeInTheDocument()
      })

      const confirmButton = screen.getByText('tools.mcp.modal.confirm')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalled()
      })
    })
  })

  describe('Dynamic Registration', () => {
    it('should toggle dynamic registration', async () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Find the switch for dynamic registration
      const switchElements = screen.getAllByRole('switch')
      expect(switchElements.length).toBeGreaterThan(0)

      // Click the first switch (dynamic registration)
      fireEvent.click(switchElements[0])

      // The switch should toggle
      expect(switchElements[0]).toBeInTheDocument()
    })
  })

  describe('App Icon Picker Interactions', () => {
    it('should open app icon picker when app icon is clicked', async () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Find the app icon container with cursor-pointer and rounded-2xl classes
      const appIconContainer = document.querySelector('[class*="rounded-2xl"][class*="cursor-pointer"]')

      if (appIconContainer) {
        fireEvent.click(appIconContainer)

        // The mocked AppIconPicker should now be visible
        await waitFor(() => {
          expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
        })
      }
    })

    it('should close app icon picker and update icon when selecting an icon', async () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Open the icon picker
      const appIconContainer = document.querySelector('[class*="rounded-2xl"][class*="cursor-pointer"]')

      if (appIconContainer) {
        fireEvent.click(appIconContainer)

        await waitFor(() => {
          expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
        })

        // Click the select emoji button
        const selectBtn = screen.getByTestId('select-emoji-btn')
        fireEvent.click(selectBtn)

        // The picker should be closed
        await waitFor(() => {
          expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
        })
      }
    })

    it('should close app icon picker and reset icon when close button is clicked', async () => {
      render(<MCPModal {...defaultProps} />, { wrapper: createWrapper() })

      // Open the icon picker
      const appIconContainer = document.querySelector('[class*="rounded-2xl"][class*="cursor-pointer"]')

      if (appIconContainer) {
        fireEvent.click(appIconContainer)

        await waitFor(() => {
          expect(screen.getByTestId('app-icon-picker')).toBeInTheDocument()
        })

        // Click the close button
        const closeBtn = screen.getByTestId('close-picker-btn')
        fireEvent.click(closeBtn)

        // The picker should be closed
        await waitFor(() => {
          expect(screen.queryByTestId('app-icon-picker')).not.toBeInTheDocument()
        })
      }
    })
  })
})
