import type { TryAppInfo } from '@/service/try-app'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppInfo from './index'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'types.advanced': 'Advanced',
        'types.chatbot': 'Chatbot',
        'types.agent': 'Agent',
        'types.workflow': 'Workflow',
        'types.completion': 'Completion',
        'tryApp.createFromSampleApp': 'Create from Sample',
        'tryApp.category': 'Category',
        'tryApp.requirements': 'Requirements',
      }
      return translations[key] || key
    },
  }),
}))

const mockUseGetRequirements = vi.fn()

vi.mock('./use-get-requirements', () => ({
  default: (...args: unknown[]) => mockUseGetRequirements(...args),
}))

const createMockAppDetail = (mode: string, overrides: Partial<TryAppInfo> = {}): TryAppInfo => ({
  id: 'test-app-id',
  name: 'Test App Name',
  description: 'Test App Description',
  mode,
  site: {
    title: 'Test Site Title',
    icon: '🚀',
    icon_type: 'emoji',
    icon_background: '#FFFFFF',
    icon_url: '',
  },
  model_config: {
    model: {
      provider: 'langgenius/openai/openai',
      name: 'gpt-4',
      mode: 'chat',
    },
    dataset_configs: {
      datasets: {
        datasets: [],
      },
    },
    agent_mode: {
      tools: [],
    },
    user_input_form: [],
  },
  ...overrides,
} as unknown as TryAppInfo)

describe('AppInfo', () => {
  beforeEach(() => {
    mockUseGetRequirements.mockReturnValue({
      requirements: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('app name and icon', () => {
    it('renders app name', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('Test App Name')).toBeInTheDocument()
    })

    it('renders app name with title attribute', () => {
      const appDetail = createMockAppDetail('chat', {
        name: 'Very Long App Name That Should Be Truncated',
      } as Partial<TryAppInfo>)
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      const nameElement = screen.getByText('Very Long App Name That Should Be Truncated')
      expect(nameElement).toHaveAttribute('title', 'Very Long App Name That Should Be Truncated')
    })
  })

  describe('app type', () => {
    it('displays ADVANCED for advanced-chat mode', () => {
      const appDetail = createMockAppDetail('advanced-chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('ADVANCED')).toBeInTheDocument()
    })

    it('displays CHATBOT for chat mode', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('CHATBOT')).toBeInTheDocument()
    })

    it('displays AGENT for agent-chat mode', () => {
      const appDetail = createMockAppDetail('agent-chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('AGENT')).toBeInTheDocument()
    })

    it('displays WORKFLOW for workflow mode', () => {
      const appDetail = createMockAppDetail('workflow')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('WORKFLOW')).toBeInTheDocument()
    })

    it('displays COMPLETION for completion mode', () => {
      const appDetail = createMockAppDetail('completion')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('COMPLETION')).toBeInTheDocument()
    })
  })

  describe('description', () => {
    it('renders description when provided', () => {
      const appDetail = createMockAppDetail('chat', {
        description: 'This is a test description',
      } as Partial<TryAppInfo>)
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('This is a test description')).toBeInTheDocument()
    })

    it('does not render description when empty', () => {
      const appDetail = createMockAppDetail('chat', {
        description: '',
      } as Partial<TryAppInfo>)
      const mockOnCreate = vi.fn()

      const { container } = render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      // Check that there's no element with the description class that has empty content
      const descriptionElements = container.querySelectorAll('.system-sm-regular.mt-\\[14px\\]')
      expect(descriptionElements.length).toBe(0)
    })
  })

  describe('create button', () => {
    it('renders create button with correct text', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('Create from Sample')).toBeInTheDocument()
    })

    it('calls onCreate when button is clicked', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      fireEvent.click(screen.getByText('Create from Sample'))
      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('category', () => {
    it('renders category when provided', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          category="AI Assistant"
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('Category')).toBeInTheDocument()
      expect(screen.getByText('AI Assistant')).toBeInTheDocument()
    })

    it('does not render category section when not provided', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.queryByText('Category')).not.toBeInTheDocument()
    })
  })

  describe('requirements', () => {
    it('renders requirements when available', () => {
      mockUseGetRequirements.mockReturnValue({
        requirements: [
          { name: 'OpenAI GPT-4', iconUrl: 'https://example.com/icon1.png' },
          { name: 'Google Search', iconUrl: 'https://example.com/icon2.png' },
        ],
      })

      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('Requirements')).toBeInTheDocument()
      expect(screen.getByText('OpenAI GPT-4')).toBeInTheDocument()
      expect(screen.getByText('Google Search')).toBeInTheDocument()
    })

    it('does not render requirements section when empty', () => {
      mockUseGetRequirements.mockReturnValue({
        requirements: [],
      })

      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.queryByText('Requirements')).not.toBeInTheDocument()
    })

    it('renders requirement icons with correct background image', () => {
      mockUseGetRequirements.mockReturnValue({
        requirements: [
          { name: 'Test Tool', iconUrl: 'https://example.com/test-icon.png' },
        ],
      })

      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      const { container } = render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      const iconElement = container.querySelector('[style*="background-image"]')
      expect(iconElement).toBeInTheDocument()
      expect(iconElement).toHaveStyle({ backgroundImage: 'url(https://example.com/test-icon.png)' })
    })
  })

  describe('className prop', () => {
    it('applies custom className', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      const { container } = render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          className="custom-class"
          onCreate={mockOnCreate}
        />,
      )

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('hook calls', () => {
    it('calls useGetRequirements with correct parameters', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="my-app-id"
          appDetail={appDetail}
          onCreate={mockOnCreate}
        />,
      )

      expect(mockUseGetRequirements).toHaveBeenCalledWith({
        appDetail,
        appId: 'my-app-id',
      })
    })
  })
})
