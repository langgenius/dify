import type { ReactNode } from 'react'
import type { PluginPayload } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../types'
import Authorize from './index'

// Create a wrapper with QueryClientProvider for real component testing
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const createWrapper = () => {
  const testQueryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Mock API hooks - only mock network-related hooks
const mockGetPluginOAuthClientSchema = vi.fn()

vi.mock('../hooks/use-credential', () => ({
  useGetPluginOAuthUrlHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ authorization_url: '' }),
  }),
  useGetPluginOAuthClientSchemaHook: () => ({
    data: mockGetPluginOAuthClientSchema(),
    isLoading: false,
  }),
  useSetPluginOAuthCustomClientHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useDeletePluginOAuthCustomClientHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useInvalidPluginOAuthClientSchemaHook: () => vi.fn(),
  useAddPluginCredentialHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  }),
  useGetPluginCredentialSchemaHook: () => ({
    data: [],
    isLoading: false,
  }),
}))

// Mock openOAuthPopup - window operations
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

// Mock service/use-triggers - API service
vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({
    data: { options: [] },
    isLoading: false,
  }),
  useTriggerPluginDynamicOptionsInfo: () => ({
    data: null,
    isLoading: false,
  }),
  useInvalidTriggerDynamicOptions: () => vi.fn(),
}))

// Factory function for creating test PluginPayload
const createPluginPayload = (overrides: Partial<PluginPayload> = {}): PluginPayload => ({
  category: AuthCategory.tool,
  provider: 'test-provider',
  ...overrides,
})

describe('Authorize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    })
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render nothing when canOAuth and canApiKey are both false/undefined', () => {
      const pluginPayload = createPluginPayload()

      const { container } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={false}
          canApiKey={false}
        />,
        { wrapper: createWrapper() },
      )

      // No buttons should be rendered
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      // Container should only have wrapper element
      expect(container.querySelector('.flex')).toBeInTheDocument()
    })

    it('should render only OAuth button when canOAuth is true and canApiKey is false', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={false}
        />,
        { wrapper: createWrapper() },
      )

      // OAuth button should exist (either configured or setup button)
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render only API Key button when canApiKey is true and canOAuth is false', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={false}
          canApiKey={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render both OAuth and API Key buttons when both are true', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
        />,
        { wrapper: createWrapper() },
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2)
    })

    it('should render divider when showDivider is true and both buttons are shown', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          showDivider={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('or')).toBeInTheDocument()
    })

    it('should not render divider when showDivider is false', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          showDivider={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByText('or')).not.toBeInTheDocument()
    })

    it('should not render divider when only one button type is shown', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={false}
          showDivider={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByText('or')).not.toBeInTheDocument()
    })

    it('should render divider by default (showDivider defaults to true)', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('or')).toBeInTheDocument()
    })
  })

  // ==================== Props Testing ====================
  describe('Props Testing', () => {
    describe('theme prop', () => {
      it('should render buttons with secondary theme variant when theme is secondary', () => {
        const pluginPayload = createPluginPayload()

        render(
          <Authorize
            pluginPayload={pluginPayload}
            theme="secondary"
            canOAuth={true}
            canApiKey={true}
          />,
          { wrapper: createWrapper() },
        )

        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button.className).toContain('btn-secondary')
        })
      })
    })

    describe('disabled prop', () => {
      it('should disable OAuth button when disabled is true', () => {
        const pluginPayload = createPluginPayload()

        render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            disabled={true}
          />,
          { wrapper: createWrapper() },
        )

        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should disable API Key button when disabled is true', () => {
        const pluginPayload = createPluginPayload()

        render(
          <Authorize
            pluginPayload={pluginPayload}
            canApiKey={true}
            disabled={true}
          />,
          { wrapper: createWrapper() },
        )

        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should not disable buttons when disabled is false', () => {
        const pluginPayload = createPluginPayload()

        render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            canApiKey={true}
            disabled={false}
          />,
          { wrapper: createWrapper() },
        )

        const buttons = screen.getAllByRole('button')
        buttons.forEach((button) => {
          expect(button).not.toBeDisabled()
        })
      })
    })

    describe('notAllowCustomCredential prop', () => {
      it('should disable OAuth button when notAllowCustomCredential is true', () => {
        const pluginPayload = createPluginPayload()

        render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            notAllowCustomCredential={true}
          />,
          { wrapper: createWrapper() },
        )

        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should disable API Key button when notAllowCustomCredential is true', () => {
        const pluginPayload = createPluginPayload()

        render(
          <Authorize
            pluginPayload={pluginPayload}
            canApiKey={true}
            notAllowCustomCredential={true}
          />,
          { wrapper: createWrapper() },
        )

        expect(screen.getByRole('button')).toBeDisabled()
      })

      it('should add opacity class when notAllowCustomCredential is true', () => {
        const pluginPayload = createPluginPayload()

        const { container } = render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            canApiKey={true}
            notAllowCustomCredential={true}
          />,
          { wrapper: createWrapper() },
        )

        const wrappers = container.querySelectorAll('.opacity-50')
        expect(wrappers.length).toBe(2) // Both OAuth and API Key wrappers
      })
    })
  })

  // ==================== Button Text Variations ====================
  describe('Button Text Variations', () => {
    it('should show correct OAuth text based on canApiKey', () => {
      const pluginPayload = createPluginPayload()

      // When canApiKey is false, should show "useOAuthAuth"
      const { rerender } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toHaveTextContent('plugin.auth')

      // When canApiKey is true, button text changes
      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
        />,
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2)
    })
  })

  // ==================== Memoization Dependencies ====================
  describe('Memoization and Re-rendering', () => {
    it('should maintain stable props across re-renders with same dependencies', () => {
      const pluginPayload = createPluginPayload()
      const onUpdate = vi.fn()

      const { rerender } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          theme="primary"
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      const initialButtonCount = screen.getAllByRole('button').length

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          theme="primary"
          onUpdate={onUpdate}
        />,
      )

      expect(screen.getAllByRole('button').length).toBe(initialButtonCount)
    })

    it('should update when canApiKey changes', () => {
      const pluginPayload = createPluginPayload()

      const { rerender } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getAllByRole('button').length).toBe(1)

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
        />,
      )

      expect(screen.getAllByRole('button').length).toBe(2)
    })

    it('should update when canOAuth changes', () => {
      const pluginPayload = createPluginPayload()

      const { rerender } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={false}
          canApiKey={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getAllByRole('button').length).toBe(1)

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
        />,
      )

      expect(screen.getAllByRole('button').length).toBe(2)
    })

    it('should update button variant when theme changes', () => {
      const pluginPayload = createPluginPayload()

      const { rerender } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canApiKey={true}
          theme="primary"
        />,
        { wrapper: createWrapper() },
      )

      const buttonPrimary = screen.getByRole('button')
      // Primary theme with canOAuth=false should have primary variant
      expect(buttonPrimary.className).toContain('btn-primary')

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canApiKey={true}
          theme="secondary"
        />,
      )

      expect(screen.getByRole('button').className).toContain('btn-secondary')
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle undefined pluginPayload properties gracefully', () => {
      const pluginPayload: PluginPayload = {
        category: AuthCategory.tool,
        provider: 'test-provider',
        providerType: undefined,
        detail: undefined,
      }

      expect(() => {
        render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            canApiKey={true}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })

    it('should handle all auth categories', () => {
      const categories = [AuthCategory.tool, AuthCategory.datasource, AuthCategory.model, AuthCategory.trigger]

      categories.forEach((category) => {
        const pluginPayload = createPluginPayload({ category })

        const { unmount } = render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            canApiKey={true}
          />,
          { wrapper: createWrapper() },
        )

        expect(screen.getAllByRole('button').length).toBe(2)

        unmount()
      })
    })

    it('should handle empty string provider', () => {
      const pluginPayload = createPluginPayload({ provider: '' })

      expect(() => {
        render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })

    it('should handle both disabled and notAllowCustomCredential together', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          disabled={true}
          notAllowCustomCredential={true}
        />,
        { wrapper: createWrapper() },
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeDisabled()
      })
    })
  })

  // ==================== Component Memoization ====================
  describe('Component Memoization', () => {
    it('should be a memoized component (exported with memo)', async () => {
      const AuthorizeDefault = (await import('./index')).default
      expect(AuthorizeDefault).toBeDefined()
      // memo wrapped components are React elements with $$typeof
      expect(typeof AuthorizeDefault).toBe('object')
    })

    it('should not re-render wrapper when notAllowCustomCredential stays the same', () => {
      const pluginPayload = createPluginPayload()
      const onUpdate = vi.fn()

      const { rerender, container } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          notAllowCustomCredential={false}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      const initialOpacityElements = container.querySelectorAll('.opacity-50').length

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          notAllowCustomCredential={false}
          onUpdate={onUpdate}
        />,
      )

      expect(container.querySelectorAll('.opacity-50').length).toBe(initialOpacityElements)
    })

    it('should update wrapper when notAllowCustomCredential changes', () => {
      const pluginPayload = createPluginPayload()

      const { rerender, container } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          notAllowCustomCredential={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(container.querySelectorAll('.opacity-50').length).toBe(0)

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          notAllowCustomCredential={true}
        />,
      )

      expect(container.querySelectorAll('.opacity-50').length).toBe(1)
    })
  })

  // ==================== Integration with pluginPayload ====================
  describe('pluginPayload Integration', () => {
    it('should pass pluginPayload to OAuth button', () => {
      const pluginPayload = createPluginPayload({
        provider: 'special-provider',
        category: AuthCategory.model,
      })

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should pass pluginPayload to API Key button', () => {
      const pluginPayload = createPluginPayload({
        provider: 'another-provider',
        category: AuthCategory.datasource,
      })

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canApiKey={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle pluginPayload with detail property', () => {
      const pluginPayload = createPluginPayload({
        detail: {
          plugin_id: 'test-plugin',
          name: 'Test Plugin',
        } as PluginPayload['detail'],
      })

      expect(() => {
        render(
          <Authorize
            pluginPayload={pluginPayload}
            canOAuth={true}
            canApiKey={true}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })
  })

  // ==================== Conditional Rendering Scenarios ====================
  describe('Conditional Rendering Scenarios', () => {
    it('should handle rapid prop changes', () => {
      const pluginPayload = createPluginPayload()

      const { rerender } = render(
        <Authorize pluginPayload={pluginPayload} canOAuth={true} canApiKey={true} />,
        { wrapper: createWrapper() },
      )

      expect(screen.getAllByRole('button').length).toBe(2)

      rerender(<Authorize pluginPayload={pluginPayload} canOAuth={false} canApiKey={true} />)
      expect(screen.getAllByRole('button').length).toBe(1)

      rerender(<Authorize pluginPayload={pluginPayload} canOAuth={true} canApiKey={false} />)
      expect(screen.getAllByRole('button').length).toBe(1)

      rerender(<Authorize pluginPayload={pluginPayload} canOAuth={false} canApiKey={false} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('should correctly toggle divider visibility based on button combinations', () => {
      const pluginPayload = createPluginPayload()

      const { rerender } = render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          showDivider={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('or')).toBeInTheDocument()

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={false}
          showDivider={true}
        />,
      )

      expect(screen.queryByText('or')).not.toBeInTheDocument()

      rerender(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={false}
          canApiKey={true}
          showDivider={true}
        />,
      )

      expect(screen.queryByText('or')).not.toBeInTheDocument()
    })
  })

  // ==================== Accessibility ====================
  describe('Accessibility', () => {
    it('should have accessible button elements', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
        />,
        { wrapper: createWrapper() },
      )

      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBe(2)
    })

    it('should indicate disabled state for accessibility', () => {
      const pluginPayload = createPluginPayload()

      render(
        <Authorize
          pluginPayload={pluginPayload}
          canOAuth={true}
          canApiKey={true}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      const buttons = screen.getAllByRole('button')
      buttons.forEach((button) => {
        expect(button).toBeDisabled()
      })
    })
  })
})
