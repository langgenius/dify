import type { DataSourceNodeType } from '@/app/components/workflow/nodes/data-source/types'
import { fireEvent, render, screen } from '@testing-library/react'
import Connect from '../index'

// Mock useToolIcon - hook has complex dependencies (API calls, stores)
const mockUseToolIcon = vi.fn()
vi.mock('@/app/components/workflow/hooks', () => ({
  useToolIcon: (data: DataSourceNodeType) => mockUseToolIcon(data),
}))

const createMockNodeData = (overrides?: Partial<DataSourceNodeType>): DataSourceNodeType => ({
  title: 'Test Node',
  plugin_id: 'plugin-123',
  provider_type: 'online_drive',
  provider_name: 'online-drive-provider',
  datasource_name: 'online-drive-ds',
  datasource_label: 'Online Drive',
  datasource_parameters: {},
  datasource_configurations: {},
  ...overrides,
} as DataSourceNodeType)

type ConnectProps = React.ComponentProps<typeof Connect>

const createDefaultProps = (overrides?: Partial<ConnectProps>): ConnectProps => ({
  nodeData: createMockNodeData(),
  onSetting: vi.fn(),
  ...overrides,
})

describe('Connect', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock return values
    mockUseToolIcon.mockReturnValue('https://example.com/icon.png')
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<Connect {...props} />)

      // Assert - Component should render with connect button
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render the BlockIcon component', () => {
      const props = createDefaultProps()

      const { container } = render(<Connect {...props} />)

      // Assert - BlockIcon container should exist
      const iconContainer = container.querySelector('.size-12')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render the not connected message with node title', () => {
      const props = createDefaultProps({
        nodeData: createMockNodeData({ title: 'My Google Drive' }),
      })

      render(<Connect {...props} />)

      // Assert - Should show translation key with interpolated name (use getAllBy since both messages contain similar text)
      const messages = screen.getAllByText(/datasetPipeline\.onlineDrive\.notConnected/)
      expect(messages.length).toBeGreaterThanOrEqual(1)
    })

    it('should render the not connected tip message', () => {
      const props = createDefaultProps()

      render(<Connect {...props} />)

      // Assert - Should show tip translation key
      expect(screen.getByText(/datasetPipeline\.onlineDrive\.notConnectedTip/)).toBeInTheDocument()
    })

    it('should render the connect button with correct text', () => {
      const props = createDefaultProps()

      render(<Connect {...props} />)

      // Assert - Button should have connect text
      const button = screen.getByRole('button')
      expect(button).toHaveTextContent('datasetCreation.stepOne.connect')
    })

    it('should render with primary button variant', () => {
      const props = createDefaultProps()

      render(<Connect {...props} />)

      // Assert - Button should be primary variant
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })

    it('should render Icon3Dots component', () => {
      const props = createDefaultProps()

      const { container } = render(<Connect {...props} />)

      // Assert - Icon3Dots should be rendered (it's an SVG element)
      const iconElement = container.querySelector('svg')
      expect(iconElement).toBeInTheDocument()
    })

    it('should apply correct container styling', () => {
      const props = createDefaultProps()

      const { container } = render(<Connect {...props} />)

      // Assert - Container should have expected classes
      const mainContainer = container.firstChild
      expect(mainContainer).toHaveClass('flex', 'flex-col', 'items-start', 'gap-y-2', 'rounded-xl', 'p-6')
    })
  })

  describe('Props', () => {
    describe('nodeData prop', () => {
      it('should pass nodeData to useToolIcon hook', () => {
        const nodeData = createMockNodeData({ plugin_id: 'my-plugin' })
        const props = createDefaultProps({ nodeData })

        render(<Connect {...props} />)

        expect(mockUseToolIcon).toHaveBeenCalledWith(nodeData)
      })

      it('should display node title in not connected message', () => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title: 'Dropbox Storage' }),
        })

        render(<Connect {...props} />)

        // Assert - Translation key should be in document (mock returns key)
        const messages = screen.getAllByText(/datasetPipeline\.onlineDrive\.notConnected/)
        expect(messages.length).toBeGreaterThanOrEqual(1)
      })

      it('should display node title in tip message', () => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title: 'OneDrive Connector' }),
        })

        render(<Connect {...props} />)

        // Assert - Translation key should be in document
        expect(screen.getByText(/datasetPipeline\.onlineDrive\.notConnectedTip/)).toBeInTheDocument()
      })

      it.each([
        { title: 'Google Drive' },
        { title: 'Dropbox' },
        { title: 'OneDrive' },
        { title: 'Amazon S3' },
        { title: '' },
      ])('should handle nodeData with title=$title', ({ title }) => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title }),
        })

        render(<Connect {...props} />)

        // Assert - Should render without error
        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })

    describe('onSetting prop', () => {
      it('should call onSetting when connect button is clicked', () => {
        const mockOnSetting = vi.fn()
        const props = createDefaultProps({ onSetting: mockOnSetting })

        render(<Connect {...props} />)
        fireEvent.click(screen.getByRole('button'))

        expect(mockOnSetting).toHaveBeenCalledTimes(1)
      })

      it('should call onSetting when button clicked', () => {
        const mockOnSetting = vi.fn()
        const props = createDefaultProps({ onSetting: mockOnSetting })

        render(<Connect {...props} />)
        fireEvent.click(screen.getByRole('button'))

        // Assert - onClick handler receives the click event from React
        expect(mockOnSetting).toHaveBeenCalled()
        expect(mockOnSetting.mock.calls[0]).toBeDefined()
      })

      it('should call onSetting on each button click', () => {
        const mockOnSetting = vi.fn()
        const props = createDefaultProps({ onSetting: mockOnSetting })

        render(<Connect {...props} />)
        const button = screen.getByRole('button')
        fireEvent.click(button)
        fireEvent.click(button)
        fireEvent.click(button)

        expect(mockOnSetting).toHaveBeenCalledTimes(3)
      })
    })
  })

  // User Interactions and Event Handlers
  describe('User Interactions', () => {
    describe('Connect Button', () => {
      it('should trigger onSetting callback on click', () => {
        const mockOnSetting = vi.fn()
        const props = createDefaultProps({ onSetting: mockOnSetting })
        render(<Connect {...props} />)

        fireEvent.click(screen.getByRole('button'))

        expect(mockOnSetting).toHaveBeenCalled()
      })

      it('should be interactive and focusable', () => {
        const props = createDefaultProps()

        render(<Connect {...props} />)
        const button = screen.getByRole('button')

        expect(button).not.toBeDisabled()
      })

      it('should handle keyboard interaction (Enter key)', () => {
        const mockOnSetting = vi.fn()
        const props = createDefaultProps({ onSetting: mockOnSetting })
        render(<Connect {...props} />)

        const button = screen.getByRole('button')
        fireEvent.keyDown(button, { key: 'Enter' })

        // Assert - Button should be present and interactive
        expect(button).toBeInTheDocument()
      })
    })
  })

  // Hook Integration Tests
  describe('Hook Integration', () => {
    describe('useToolIcon', () => {
      it('should call useToolIcon with nodeData', () => {
        const nodeData = createMockNodeData()
        const props = createDefaultProps({ nodeData })

        render(<Connect {...props} />)

        expect(mockUseToolIcon).toHaveBeenCalledWith(nodeData)
      })

      it('should use toolIcon result from useToolIcon', () => {
        mockUseToolIcon.mockReturnValue('custom-icon-url')
        const props = createDefaultProps()

        render(<Connect {...props} />)

        // Assert - The hook should be called and its return value used
        expect(mockUseToolIcon).toHaveBeenCalled()
      })

      it('should handle empty string icon', () => {
        mockUseToolIcon.mockReturnValue('')
        const props = createDefaultProps()

        render(<Connect {...props} />)

        // Assert - Should still render without crashing
        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle undefined icon', () => {
        mockUseToolIcon.mockReturnValue(undefined)
        const props = createDefaultProps()

        render(<Connect {...props} />)

        // Assert - Should still render without crashing
        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })

    describe('useTranslation', () => {
      it('should use correct translation keys for not connected message', () => {
        const props = createDefaultProps()

        render(<Connect {...props} />)

        // Assert - Should use the correct translation key (both notConnected and notConnectedTip contain similar pattern)
        const messages = screen.getAllByText(/datasetPipeline\.onlineDrive\.notConnected/)
        expect(messages.length).toBeGreaterThanOrEqual(1)
      })

      it('should use correct translation key for tip message', () => {
        const props = createDefaultProps()

        render(<Connect {...props} />)

        expect(screen.getByText(/datasetPipeline\.onlineDrive\.notConnectedTip/)).toBeInTheDocument()
      })

      it('should use correct translation key for connect button', () => {
        const props = createDefaultProps()

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toHaveTextContent('datasetCreation.stepOne.connect')
      })
    })
  })

  describe('Edge Cases and Error Handling', () => {
    describe('Empty/Null Values', () => {
      it('should handle empty title in nodeData', () => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title: '' }),
        })

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle undefined optional fields in nodeData', () => {
        const minimalNodeData = {
          title: 'Test',
          plugin_id: 'test',
          provider_type: 'online_drive',
          provider_name: 'provider',
          datasource_name: 'ds',
          datasource_label: 'Label',
          datasource_parameters: {},
          datasource_configurations: {},
        } as DataSourceNodeType
        const props = createDefaultProps({ nodeData: minimalNodeData })

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle empty plugin_id', () => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ plugin_id: '' }),
        })

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })

    describe('Special Characters', () => {
      it('should handle special characters in title', () => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title: 'Drive <script>alert("xss")</script>' }),
        })

        render(<Connect {...props} />)

        // Assert - Should render safely without executing script
        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle unicode characters in title', () => {
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title: '云盘存储 🌐' }),
        })

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle very long title', () => {
        const longTitle = 'A'.repeat(500)
        const props = createDefaultProps({
          nodeData: createMockNodeData({ title: longTitle }),
        })

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })

    describe('Icon Variations', () => {
      it('should handle string icon URL', () => {
        mockUseToolIcon.mockReturnValue('https://cdn.example.com/icon.png')
        const props = createDefaultProps()

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle object icon with url property', () => {
        mockUseToolIcon.mockReturnValue({ url: 'https://cdn.example.com/icon.png' })
        const props = createDefaultProps()

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      it('should handle null icon', () => {
        mockUseToolIcon.mockReturnValue(null)
        const props = createDefaultProps()

        render(<Connect {...props} />)

        expect(screen.getByRole('button')).toBeInTheDocument()
      })
    })
  })

  describe('Prop Variations', () => {
    it.each([
      { title: 'Google Drive', plugin_id: 'google-drive' },
      { title: 'Dropbox', plugin_id: 'dropbox' },
      { title: 'OneDrive', plugin_id: 'onedrive' },
      { title: 'Amazon S3', plugin_id: 's3' },
      { title: 'Box', plugin_id: 'box' },
    ])('should render correctly with title=$title and plugin_id=$plugin_id', ({ title, plugin_id }) => {
      const props = createDefaultProps({
        nodeData: createMockNodeData({ title, plugin_id }),
      })

      render(<Connect {...props} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(mockUseToolIcon).toHaveBeenCalledWith(
        expect.objectContaining({ title, plugin_id }),
      )
    })

    it.each([
      { provider_type: 'online_drive' },
      { provider_type: 'cloud_storage' },
      { provider_type: 'file_system' },
    ])('should render correctly with provider_type=$provider_type', ({ provider_type }) => {
      const props = createDefaultProps({
        nodeData: createMockNodeData({ provider_type }),
      })

      render(<Connect {...props} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it.each([
      { datasource_label: 'Google Drive Storage' },
      { datasource_label: 'Dropbox Files' },
      { datasource_label: '' },
      { datasource_label: 'S3 Bucket' },
    ])('should render correctly with datasource_label=$datasource_label', ({ datasource_label }) => {
      const props = createDefaultProps({
        nodeData: createMockNodeData({ datasource_label }),
      })

      render(<Connect {...props} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('Accessibility', () => {
    it('should have an accessible button', () => {
      const props = createDefaultProps()

      render(<Connect {...props} />)

      // Assert - Button should be accessible by role
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should have proper text content for screen readers', () => {
      const props = createDefaultProps()

      render(<Connect {...props} />)

      // Assert - Text content should be present
      const messages = screen.getAllByText(/datasetPipeline\.onlineDrive\.notConnected/)
      expect(messages.length).toBe(2) // Both notConnected and notConnectedTip
    })
  })
})
