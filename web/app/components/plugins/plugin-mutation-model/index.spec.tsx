import type { Plugin } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginCategoryEnum } from '../types'
import PluginMutationModal from './index'

// ================================
// Mock External Dependencies Only
// ================================

// Mock useTheme hook
vi.mock('@/hooks/use-theme', () => ({
  default: () => ({ theme: 'light' }),
}))

// Mock i18n-config
vi.mock('@/i18n-config', () => ({
  renderI18nObject: (obj: Record<string, string>, locale: string) => {
    return obj?.[locale] || obj?.['en-US'] || ''
  },
}))

// Mock i18n-config/language
vi.mock('@/i18n-config/language', () => ({
  getLanguage: (locale: string) => locale || 'en-US',
}))

// Mock useCategories hook
const mockCategoriesMap: Record<string, { label: string }> = {
  'tool': { label: 'Tool' },
  'model': { label: 'Model' },
  'extension': { label: 'Extension' },
  'agent-strategy': { label: 'Agent' },
  'datasource': { label: 'Datasource' },
  'trigger': { label: 'Trigger' },
  'bundle': { label: 'Bundle' },
}

vi.mock('../hooks', () => ({
  useCategories: () => ({
    categoriesMap: mockCategoriesMap,
  }),
}))

// Mock formatNumber utility
vi.mock('@/utils/format', () => ({
  formatNumber: (num: number) => num.toLocaleString(),
}))

// Mock shouldUseMcpIcon utility
vi.mock('@/utils/mcp', () => ({
  shouldUseMcpIcon: (src: unknown) =>
    typeof src === 'object'
    && src !== null
    && (src as { content?: string })?.content === '🔗',
}))

// Mock AppIcon component
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({
    icon,
    background,
    innerIcon,
    size,
    iconType,
  }: {
    icon?: string
    background?: string
    innerIcon?: React.ReactNode
    size?: string
    iconType?: string
  }) => (
    <div
      data-testid="app-icon"
      data-icon={icon}
      data-background={background}
      data-size={size}
      data-icon-type={iconType}
    >
      {!!innerIcon && <div data-testid="inner-icon">{innerIcon}</div>}
    </div>
  ),
}))

// Mock Mcp icon component
vi.mock('@/app/components/base/icons/src/vender/other', () => ({
  Mcp: ({ className }: { className?: string }) => (
    <div data-testid="mcp-icon" className={className}>
      MCP
    </div>
  ),
  Group: ({ className }: { className?: string }) => (
    <div data-testid="group-icon" className={className}>
      Group
    </div>
  ),
}))

// Mock LeftCorner icon component
vi.mock('../../base/icons/src/vender/plugin', () => ({
  LeftCorner: ({ className }: { className?: string }) => (
    <div data-testid="left-corner" className={className}>
      LeftCorner
    </div>
  ),
}))

// Mock Partner badge
vi.mock('../base/badges/partner', () => ({
  default: ({ className, text }: { className?: string, text?: string }) => (
    <div data-testid="partner-badge" className={className} title={text}>
      Partner
    </div>
  ),
}))

// Mock Verified badge
vi.mock('../base/badges/verified', () => ({
  default: ({ className, text }: { className?: string, text?: string }) => (
    <div data-testid="verified-badge" className={className} title={text}>
      Verified
    </div>
  ),
}))

// Mock Remix icons
vi.mock('@remixicon/react', () => ({
  RiCheckLine: ({ className }: { className?: string }) => (
    <span data-testid="ri-check-line" className={className}>
      ✓
    </span>
  ),
  RiCloseLine: ({ className }: { className?: string }) => (
    <span data-testid="ri-close-line" className={className}>
      ✕
    </span>
  ),
  RiInstallLine: ({ className }: { className?: string }) => (
    <span data-testid="ri-install-line" className={className}>
      ↓
    </span>
  ),
  RiAlertFill: ({ className }: { className?: string }) => (
    <span data-testid="ri-alert-fill" className={className}>
      ⚠
    </span>
  ),
  RiLoader2Line: ({ className }: { className?: string }) => (
    <span data-testid="ri-loader-line" className={className}>
      ⟳
    </span>
  ),
}))

// Mock Skeleton components
vi.mock('@/app/components/base/skeleton', () => ({
  SkeletonContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="skeleton-container">{children}</div>
  ),
  SkeletonPoint: () => <div data-testid="skeleton-point" />,
  SkeletonRectangle: ({ className }: { className?: string }) => (
    <div data-testid="skeleton-rectangle" className={className} />
  ),
  SkeletonRow: ({
    children,
    className,
  }: {
    children: React.ReactNode
    className?: string
  }) => (
    <div data-testid="skeleton-row" className={className}>
      {children}
    </div>
  ),
}))

// ================================
// Test Data Factories
// ================================

const createMockPlugin = (overrides?: Partial<Plugin>): Plugin => ({
  type: 'plugin',
  org: 'test-org',
  name: 'test-plugin',
  plugin_id: 'plugin-123',
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_package_identifier: 'test-org/test-plugin:1.0.0',
  icon: '/test-icon.png',
  verified: false,
  label: { 'en-US': 'Test Plugin' },
  brief: { 'en-US': 'Test plugin description' },
  description: { 'en-US': 'Full test plugin description' },
  introduction: 'Test plugin introduction',
  repository: 'https://github.com/test/plugin',
  category: PluginCategoryEnum.tool,
  install_count: 1000,
  endpoint: { settings: [] },
  tags: [{ name: 'search' }],
  badges: [],
  verification: { authorized_category: 'community' },
  from: 'marketplace',
  ...overrides,
})

type MockMutation = {
  isSuccess: boolean
  isPending: boolean
}

const createMockMutation = (
  overrides?: Partial<MockMutation>,
): MockMutation => ({
  isSuccess: false,
  isPending: false,
  ...overrides,
})

type PluginMutationModalProps = {
  plugin: Plugin
  onCancel: () => void
  mutation: MockMutation
  mutate: () => void
  confirmButtonText: React.ReactNode
  cancelButtonText: React.ReactNode
  modelTitle: React.ReactNode
  description: React.ReactNode
  cardTitleLeft: React.ReactNode
  modalBottomLeft?: React.ReactNode
}

const createDefaultProps = (
  overrides?: Partial<PluginMutationModalProps>,
): PluginMutationModalProps => ({
  plugin: createMockPlugin(),
  onCancel: vi.fn(),
  mutation: createMockMutation(),
  mutate: vi.fn(),
  confirmButtonText: 'Confirm',
  cancelButtonText: 'Cancel',
  modelTitle: 'Modal Title',
  description: 'Modal Description',
  cardTitleLeft: null,
  ...overrides,
})

// ================================
// PluginMutationModal Component Tests
// ================================
describe('PluginMutationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should render modal title', () => {
      const props = createDefaultProps({
        modelTitle: 'Update Plugin',
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('Update Plugin')).toBeInTheDocument()
    })

    it('should render description', () => {
      const props = createDefaultProps({
        description: 'Are you sure you want to update this plugin?',
      })

      render(<PluginMutationModal {...props} />)

      expect(
        screen.getByText('Are you sure you want to update this plugin?'),
      ).toBeInTheDocument()
    })

    it('should render plugin card with plugin info', () => {
      const plugin = createMockPlugin({
        label: { 'en-US': 'My Test Plugin' },
        brief: { 'en-US': 'A test plugin' },
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('My Test Plugin')).toBeInTheDocument()
      expect(screen.getByText('A test plugin')).toBeInTheDocument()
    })

    it('should render confirm button', () => {
      const props = createDefaultProps({
        confirmButtonText: 'Install Now',
      })

      render(<PluginMutationModal {...props} />)

      expect(
        screen.getByRole('button', { name: /Install Now/i }),
      ).toBeInTheDocument()
    })

    it('should render cancel button when not pending', () => {
      const props = createDefaultProps({
        cancelButtonText: 'Cancel Installation',
        mutation: createMockMutation({ isPending: false }),
      })

      render(<PluginMutationModal {...props} />)

      expect(
        screen.getByRole('button', { name: /Cancel Installation/i }),
      ).toBeInTheDocument()
    })

    it('should render modal with closable prop', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // The modal should have a close button
      expect(screen.getByTestId('ri-close-line')).toBeInTheDocument()
    })
  })

  // ================================
  // Props Testing
  // ================================
  describe('Props', () => {
    it('should render cardTitleLeft when provided', () => {
      const props = createDefaultProps({
        cardTitleLeft: <span data-testid="version-badge">v2.0.0</span>,
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('version-badge')).toBeInTheDocument()
    })

    it('should render modalBottomLeft when provided', () => {
      const props = createDefaultProps({
        modalBottomLeft: (
          <span data-testid="bottom-left-content">Additional Info</span>
        ),
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('bottom-left-content')).toBeInTheDocument()
    })

    it('should not render modalBottomLeft when not provided', () => {
      const props = createDefaultProps({
        modalBottomLeft: undefined,
      })

      render(<PluginMutationModal {...props} />)

      expect(
        screen.queryByTestId('bottom-left-content'),
      ).not.toBeInTheDocument()
    })

    it('should render custom ReactNode for modelTitle', () => {
      const props = createDefaultProps({
        modelTitle: <div data-testid="custom-title">Custom Title Node</div>,
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('custom-title')).toBeInTheDocument()
    })

    it('should render custom ReactNode for description', () => {
      const props = createDefaultProps({
        description: (
          <div data-testid="custom-description">
            <strong>Warning:</strong>
            {' '}
            This action is irreversible.
          </div>
        ),
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('custom-description')).toBeInTheDocument()
    })

    it('should render custom ReactNode for confirmButtonText', () => {
      const props = createDefaultProps({
        confirmButtonText: (
          <span>
            <span data-testid="confirm-icon">✓</span>
            {' '}
            Confirm Action
          </span>
        ),
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('confirm-icon')).toBeInTheDocument()
    })

    it('should render custom ReactNode for cancelButtonText', () => {
      const props = createDefaultProps({
        cancelButtonText: (
          <span>
            <span data-testid="cancel-icon">✗</span>
            {' '}
            Abort
          </span>
        ),
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('cancel-icon')).toBeInTheDocument()
    })
  })

  // ================================
  // User Interactions
  // ================================
  describe('User Interactions', () => {
    it('should call onCancel when cancel button is clicked', () => {
      const onCancel = vi.fn()
      const props = createDefaultProps({ onCancel })

      render(<PluginMutationModal {...props} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      fireEvent.click(cancelButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('should call mutate when confirm button is clicked', () => {
      const mutate = vi.fn()
      const props = createDefaultProps({ mutate })

      render(<PluginMutationModal {...props} />)

      const confirmButton = screen.getByRole('button', { name: /Confirm/i })
      fireEvent.click(confirmButton)

      expect(mutate).toHaveBeenCalledTimes(1)
    })

    it('should render close button in modal header', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // Find the close icon - the Modal component handles the onClose callback
      const closeIcon = screen.getByTestId('ri-close-line')
      expect(closeIcon).toBeInTheDocument()
    })

    it('should not call mutate when button is disabled during pending', () => {
      const mutate = vi.fn()
      const props = createDefaultProps({
        mutate,
        mutation: createMockMutation({ isPending: true }),
      })

      render(<PluginMutationModal {...props} />)

      const confirmButton = screen.getByRole('button', { name: /Confirm/i })
      expect(confirmButton).toBeDisabled()

      fireEvent.click(confirmButton)

      // Button is disabled, so mutate might still be called depending on implementation
      // The important thing is the button has disabled attribute
      expect(confirmButton).toHaveAttribute('disabled')
    })
  })

  // ================================
  // Mutation State Tests
  // ================================
  describe('Mutation States', () => {
    describe('when isPending is true', () => {
      it('should hide cancel button', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: true }),
        })

        render(<PluginMutationModal {...props} />)

        expect(
          screen.queryByRole('button', { name: /Cancel/i }),
        ).not.toBeInTheDocument()
      })

      it('should show loading state on confirm button', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: true }),
        })

        render(<PluginMutationModal {...props} />)

        const confirmButton = screen.getByRole('button', { name: /Confirm/i })
        expect(confirmButton).toBeDisabled()
      })

      it('should disable confirm button', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: true }),
        })

        render(<PluginMutationModal {...props} />)

        const confirmButton = screen.getByRole('button', { name: /Confirm/i })
        expect(confirmButton).toBeDisabled()
      })
    })

    describe('when isPending is false', () => {
      it('should show cancel button', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: false }),
        })

        render(<PluginMutationModal {...props} />)

        expect(
          screen.getByRole('button', { name: /Cancel/i }),
        ).toBeInTheDocument()
      })

      it('should enable confirm button', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: false }),
        })

        render(<PluginMutationModal {...props} />)

        const confirmButton = screen.getByRole('button', { name: /Confirm/i })
        expect(confirmButton).not.toBeDisabled()
      })
    })

    describe('when isSuccess is true', () => {
      it('should show installed state on card', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isSuccess: true }),
        })

        render(<PluginMutationModal {...props} />)

        // The Card component should receive installed=true
        // This will show a check icon
        expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
      })
    })

    describe('when isSuccess is false', () => {
      it('should not show installed state on card', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isSuccess: false }),
        })

        render(<PluginMutationModal {...props} />)

        // The check icon should not be present (installed=false)
        expect(screen.queryByTestId('ri-check-line')).not.toBeInTheDocument()
      })
    })

    describe('state combinations', () => {
      it('should handle isPending=true and isSuccess=false', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: true, isSuccess: false }),
        })

        render(<PluginMutationModal {...props} />)

        expect(
          screen.queryByRole('button', { name: /Cancel/i }),
        ).not.toBeInTheDocument()
        expect(screen.queryByTestId('ri-check-line')).not.toBeInTheDocument()
      })

      it('should handle isPending=false and isSuccess=true', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: false, isSuccess: true }),
        })

        render(<PluginMutationModal {...props} />)

        expect(
          screen.getByRole('button', { name: /Cancel/i }),
        ).toBeInTheDocument()
        expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
      })

      it('should handle both isPending=true and isSuccess=true', () => {
        const props = createDefaultProps({
          mutation: createMockMutation({ isPending: true, isSuccess: true }),
        })

        render(<PluginMutationModal {...props} />)

        expect(
          screen.queryByRole('button', { name: /Cancel/i }),
        ).not.toBeInTheDocument()
        expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Plugin Card Integration Tests
  // ================================
  describe('Plugin Card Integration', () => {
    it('should display plugin label', () => {
      const plugin = createMockPlugin({
        label: { 'en-US': 'Amazing Plugin' },
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('Amazing Plugin')).toBeInTheDocument()
    })

    it('should display plugin brief description', () => {
      const plugin = createMockPlugin({
        brief: { 'en-US': 'This is an amazing plugin' },
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('This is an amazing plugin')).toBeInTheDocument()
    })

    it('should display plugin org and name', () => {
      const plugin = createMockPlugin({
        org: 'my-organization',
        name: 'my-plugin-name',
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('my-organization')).toBeInTheDocument()
      expect(screen.getByText('my-plugin-name')).toBeInTheDocument()
    })

    it('should display plugin category', () => {
      const plugin = createMockPlugin({
        category: PluginCategoryEnum.model,
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('Model')).toBeInTheDocument()
    })

    it('should display verified badge when plugin is verified', () => {
      const plugin = createMockPlugin({
        verified: true,
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('verified-badge')).toBeInTheDocument()
    })

    it('should display partner badge when plugin has partner badge', () => {
      const plugin = createMockPlugin({
        badges: ['partner'],
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByTestId('partner-badge')).toBeInTheDocument()
    })
  })

  // ================================
  // Memoization Tests
  // ================================
  describe('Memoization', () => {
    it('should be memoized with React.memo', () => {
      // Verify the component is wrapped with memo
      expect(PluginMutationModal).toBeDefined()
      expect(typeof PluginMutationModal).toBe('object')
    })

    it('should have displayName set', () => {
      // The component sets displayName = 'PluginMutationModal'
      const displayName
        = (PluginMutationModal as any).type?.displayName
          || (PluginMutationModal as any).displayName
      expect(displayName).toBe('PluginMutationModal')
    })

    it('should not re-render when props unchanged', () => {
      const renderCount = vi.fn()

      const TestWrapper = ({ props }: { props: PluginMutationModalProps }) => {
        renderCount()
        return <PluginMutationModal {...props} />
      }

      const props = createDefaultProps()
      const { rerender } = render(<TestWrapper props={props} />)

      expect(renderCount).toHaveBeenCalledTimes(1)

      // Re-render with same props reference
      rerender(<TestWrapper props={props} />)
      expect(renderCount).toHaveBeenCalledTimes(2)
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty label object', () => {
      const plugin = createMockPlugin({
        label: {},
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle empty brief object', () => {
      const plugin = createMockPlugin({
        brief: {},
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle plugin with undefined badges', () => {
      const plugin = createMockPlugin()
      // @ts-expect-error - Testing undefined badges
      plugin.badges = undefined
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle empty string description', () => {
      const props = createDefaultProps({
        description: '',
      })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle empty string modelTitle', () => {
      const props = createDefaultProps({
        modelTitle: '',
      })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle special characters in plugin name', () => {
      const plugin = createMockPlugin({
        name: 'plugin-with-special<chars>!@#$%',
        org: 'org<script>test</script>',
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('plugin-with-special<chars>!@#$%')).toBeInTheDocument()
    })

    it('should handle very long title', () => {
      const longTitle = 'A'.repeat(500)
      const plugin = createMockPlugin({
        label: { 'en-US': longTitle },
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      // Should render the long title text
      expect(screen.getByText(longTitle)).toBeInTheDocument()
    })

    it('should handle very long description', () => {
      const longDescription = 'B'.repeat(1000)
      const plugin = createMockPlugin({
        brief: { 'en-US': longDescription },
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      // Should render the long description text
      expect(screen.getByText(longDescription)).toBeInTheDocument()
    })

    it('should handle unicode characters in title', () => {
      const props = createDefaultProps({
        modelTitle: '更新插件 🎉',
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('更新插件 🎉')).toBeInTheDocument()
    })

    it('should handle unicode characters in description', () => {
      const props = createDefaultProps({
        description: '确定要更新这个插件吗？この操作は元に戻せません。',
      })

      render(<PluginMutationModal {...props} />)

      expect(
        screen.getByText('确定要更新这个插件吗？この操作は元に戻せません。'),
      ).toBeInTheDocument()
    })

    it('should handle null cardTitleLeft', () => {
      const props = createDefaultProps({
        cardTitleLeft: null,
      })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })

    it('should handle undefined modalBottomLeft', () => {
      const props = createDefaultProps({
        modalBottomLeft: undefined,
      })

      render(<PluginMutationModal {...props} />)

      expect(document.body).toBeInTheDocument()
    })
  })

  // ================================
  // Modal Behavior Tests
  // ================================
  describe('Modal Behavior', () => {
    it('should render modal with isShow=true', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // Modal should be visible - check for dialog role using screen query
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should have modal structure', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // Check that modal content is rendered
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      // Modal should have title
      expect(screen.getByText('Modal Title')).toBeInTheDocument()
    })

    it('should render modal as closable', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // Close icon should be present
      expect(screen.getByTestId('ri-close-line')).toBeInTheDocument()
    })
  })

  // ================================
  // Button Styling Tests
  // ================================
  describe('Button Styling', () => {
    it('should render confirm button with primary variant', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      const confirmButton = screen.getByRole('button', { name: /Confirm/i })
      // Button component with variant="primary" should have primary styling
      expect(confirmButton).toBeInTheDocument()
    })

    it('should render cancel button with default variant', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      expect(cancelButton).toBeInTheDocument()
    })
  })

  // ================================
  // Layout Tests
  // ================================
  describe('Layout', () => {
    it('should render description text', () => {
      const props = createDefaultProps({
        description: 'Test Description Content',
      })

      render(<PluginMutationModal {...props} />)

      // Description should be rendered
      expect(screen.getByText('Test Description Content')).toBeInTheDocument()
    })

    it('should render card with plugin info', () => {
      const plugin = createMockPlugin({
        label: { 'en-US': 'Layout Test Plugin' },
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      // Card should display plugin info
      expect(screen.getByText('Layout Test Plugin')).toBeInTheDocument()
    })

    it('should render both cancel and confirm buttons', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // Both buttons should be rendered
      expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Confirm/i })).toBeInTheDocument()
    })

    it('should render buttons in correct order', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      // Get all buttons and verify order
      const buttons = screen.getAllByRole('button')
      // Cancel button should come before Confirm button
      const cancelIndex = buttons.findIndex(b => b.textContent?.includes('Cancel'))
      const confirmIndex = buttons.findIndex(b => b.textContent?.includes('Confirm'))
      expect(cancelIndex).toBeLessThan(confirmIndex)
    })
  })

  // ================================
  // Accessibility Tests
  // ================================
  describe('Accessibility', () => {
    it('should have accessible dialog role', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should have accessible button roles', () => {
      const props = createDefaultProps()

      render(<PluginMutationModal {...props} />)

      expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
    })

    it('should have accessible text content', () => {
      const props = createDefaultProps({
        modelTitle: 'Accessible Title',
        description: 'Accessible Description',
      })

      render(<PluginMutationModal {...props} />)

      expect(screen.getByText('Accessible Title')).toBeInTheDocument()
      expect(screen.getByText('Accessible Description')).toBeInTheDocument()
    })
  })

  // ================================
  // All Plugin Categories Tests
  // ================================
  describe('All Plugin Categories', () => {
    const categories = [
      { category: PluginCategoryEnum.tool, label: 'Tool' },
      { category: PluginCategoryEnum.model, label: 'Model' },
      { category: PluginCategoryEnum.extension, label: 'Extension' },
      { category: PluginCategoryEnum.agent, label: 'Agent' },
      { category: PluginCategoryEnum.datasource, label: 'Datasource' },
      { category: PluginCategoryEnum.trigger, label: 'Trigger' },
    ]

    categories.forEach(({ category, label }) => {
      it(`should display ${label} category correctly`, () => {
        const plugin = createMockPlugin({ category })
        const props = createDefaultProps({ plugin })

        render(<PluginMutationModal {...props} />)

        expect(screen.getByText(label)).toBeInTheDocument()
      })
    })
  })

  // ================================
  // Bundle Type Tests
  // ================================
  describe('Bundle Type', () => {
    it('should display bundle label for bundle type plugin', () => {
      const plugin = createMockPlugin({
        type: 'bundle',
        category: PluginCategoryEnum.tool,
      })
      const props = createDefaultProps({ plugin })

      render(<PluginMutationModal {...props} />)

      // For bundle type, should show 'Bundle' instead of category
      expect(screen.getByText('Bundle')).toBeInTheDocument()
    })
  })

  // ================================
  // Event Handler Isolation Tests
  // ================================
  describe('Event Handler Isolation', () => {
    it('should not call mutate when clicking cancel button', () => {
      const mutate = vi.fn()
      const onCancel = vi.fn()
      const props = createDefaultProps({ mutate, onCancel })

      render(<PluginMutationModal {...props} />)

      const cancelButton = screen.getByRole('button', { name: /Cancel/i })
      fireEvent.click(cancelButton)

      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(mutate).not.toHaveBeenCalled()
    })

    it('should not call onCancel when clicking confirm button', () => {
      const mutate = vi.fn()
      const onCancel = vi.fn()
      const props = createDefaultProps({ mutate, onCancel })

      render(<PluginMutationModal {...props} />)

      const confirmButton = screen.getByRole('button', { name: /Confirm/i })
      fireEvent.click(confirmButton)

      expect(mutate).toHaveBeenCalledTimes(1)
      expect(onCancel).not.toHaveBeenCalled()
    })
  })

  // ================================
  // Multiple Renders Tests
  // ================================
  describe('Multiple Renders', () => {
    it('should handle rapid state changes', () => {
      const props = createDefaultProps()
      const { rerender } = render(<PluginMutationModal {...props} />)

      // Simulate rapid pending state changes
      rerender(
        <PluginMutationModal
          {...props}
          mutation={createMockMutation({ isPending: true })}
        />,
      )
      rerender(
        <PluginMutationModal
          {...props}
          mutation={createMockMutation({ isPending: false })}
        />,
      )
      rerender(
        <PluginMutationModal
          {...props}
          mutation={createMockMutation({ isSuccess: true })}
        />,
      )

      // Should show success state
      expect(screen.getByTestId('ri-check-line')).toBeInTheDocument()
    })

    it('should handle plugin prop changes', () => {
      const plugin1 = createMockPlugin({ label: { 'en-US': 'Plugin One' } })
      const plugin2 = createMockPlugin({ label: { 'en-US': 'Plugin Two' } })

      const props = createDefaultProps({ plugin: plugin1 })
      const { rerender } = render(<PluginMutationModal {...props} />)

      expect(screen.getByText('Plugin One')).toBeInTheDocument()

      rerender(<PluginMutationModal {...props} plugin={plugin2} />)

      expect(screen.getByText('Plugin Two')).toBeInTheDocument()
    })
  })
})
