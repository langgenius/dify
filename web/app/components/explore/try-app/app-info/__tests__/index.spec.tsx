import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AppInfo from '../index'

const { getWorkflow } = vi.hoisted(() => ({ getWorkflow: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'trialApps.byAppId.workflows.get': getWorkflow,
    }),
  }
})

const createMockAppDetail = (
  mode: string,
  overrides: Partial<TrialAppDetailResponse> = {},
): TrialAppDetailResponse =>
  ({
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
  }) as unknown as TrialAppDetailResponse

describe('AppInfo', () => {
  beforeEach(() => {
    getWorkflow.mockResolvedValue({ graph: { nodes: [] } })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  describe('app name and icon', () => {
    it('renders app name', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('Test App Name')).toBeInTheDocument()
    })

    it('renders app name with title attribute', () => {
      const appDetail = createMockAppDetail('chat', {
        name: 'Very Long App Name That Should Be Truncated',
      } as Partial<TrialAppDetailResponse>)
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      const nameElement = screen.getByText('Very Long App Name That Should Be Truncated')
      expect(nameElement).toHaveAttribute('title', 'Very Long App Name That Should Be Truncated')
    })
  })

  describe('app type', () => {
    it('displays ADVANCED for advanced-chat mode', () => {
      const appDetail = createMockAppDetail('advanced-chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('APP.TYPES.ADVANCED')).toBeInTheDocument()
    })

    it('displays CHATBOT for chat mode', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('APP.TYPES.CHATBOT')).toBeInTheDocument()
    })

    it('displays AGENT for agent-chat mode', () => {
      const appDetail = createMockAppDetail('agent-chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('APP.TYPES.AGENT')).toBeInTheDocument()
    })

    it('displays WORKFLOW for workflow mode', () => {
      const appDetail = createMockAppDetail('workflow')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('APP.TYPES.WORKFLOW')).toBeInTheDocument()
    })

    it('displays COMPLETION for completion mode', () => {
      const appDetail = createMockAppDetail('completion')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('APP.TYPES.COMPLETION')).toBeInTheDocument()
    })
  })

  describe('description', () => {
    it('renders description when provided', () => {
      const appDetail = createMockAppDetail('chat', {
        description: 'This is a test description',
      } as Partial<TrialAppDetailResponse>)
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('This is a test description')).toBeInTheDocument()
    })

    it('does not render description when empty', () => {
      const appDetail = createMockAppDetail('chat', {
        description: '',
      } as Partial<TrialAppDetailResponse>)
      const mockOnCreate = vi.fn()

      const { container } = render(
        <AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />,
      )

      const descriptionElements = container.querySelectorAll('.system-sm-regular.mt-\\[14px\\]')
      expect(descriptionElements.length).toBe(0)
    })
  })

  describe('create button', () => {
    it('renders create button with correct text', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.getByText('explore.tryApp.createFromSampleApp')).toBeInTheDocument()
    })

    it('calls onCreate when button is clicked', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      fireEvent.click(screen.getByText('explore.tryApp.createFromSampleApp'))
      expect(mockOnCreate).toHaveBeenCalledTimes(1)
    })
  })

  describe('categories', () => {
    it('renders categories when provided', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(
        <AppInfo
          appId="test-app-id"
          appDetail={appDetail}
          categories={['AI Assistant', 'Workflow']}
          onCreate={mockOnCreate}
        />,
      )

      expect(screen.getByText('explore.tryApp.category')).toBeInTheDocument()
      expect(screen.getByText('AI Assistant')).toBeInTheDocument()
      expect(screen.getByText('Workflow')).toBeInTheDocument()
    })

    it('does not render categories section when not provided', () => {
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      expect(screen.queryByText('explore.tryApp.category')).not.toBeInTheDocument()
    })
  })

  describe('requirements', () => {
    it('derives and deduplicates dependencies from the requested workflow', async () => {
      getWorkflow.mockResolvedValue({
        graph: {
          nodes: [
            {
              data: {
                type: BlockEnum.LLM,
                model: { name: 'GPT-4', provider: 'langgenius/openai/openai' },
              },
            },
            {
              data: {
                type: BlockEnum.LLM,
                model: { name: 'GPT-4', provider: 'langgenius/openai/openai' },
              },
            },
            {
              data: {
                type: BlockEnum.Tool,
                provider_id: 'langgenius/google/google',
                tool_label: 'Google Search',
              },
            },
          ],
        },
      })
      render(
        <AppInfo
          appId="workflow-id"
          appDetail={createMockAppDetail('workflow')}
          onCreate={vi.fn()}
        />,
      )
      expect(await screen.findByText('GPT-4')).toBeInTheDocument()
      expect(screen.getAllByText('GPT-4')).toHaveLength(1)
      expect(screen.getByText('Google Search')).toBeInTheDocument()
      expect(getWorkflow).toHaveBeenCalledWith({ params: { app_id: 'workflow-id' } })
    })

    it('omits the requirements section when no dependencies are configured', () => {
      render(
        <AppInfo
          appId="test-app-id"
          appDetail={createMockAppDetail('chat', { model_config: null })}
          onCreate={vi.fn()}
        />,
      )
      expect(screen.queryByText('explore.tryApp.requirements')).not.toBeInTheDocument()
    })

    it('keeps the requirement visible when its real provider icon fails to load', () => {
      const { container } = render(
        <AppInfo appId="test-app-id" appDetail={createMockAppDetail('chat')} onCreate={vi.fn()} />,
      )
      expect(screen.getByText('openai')).toBeInTheDocument()
      const icon = container.querySelector('img[src$="/plugins/langgenius/openai/icon"]')!
      expect(icon).toBeInTheDocument()
      fireEvent.error(icon)
      expect(icon).not.toBeInTheDocument()
      expect(screen.getByText('openai')).toBeInTheDocument()
    })
  })
})
