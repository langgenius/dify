import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vite-plus/test'
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

  it.each([
    ['advanced-chat', 'ADVANCED'],
    ['chat', 'CHATBOT'],
    ['agent-chat', 'AGENT'],
    ['workflow', 'WORKFLOW'],
    ['completion', 'COMPLETION'],
  ])('identifies %s templates as %s', (mode, label) => {
    render(<AppInfo appId="test-app-id" appDetail={createMockAppDetail(mode)} onCreate={vi.fn()} />)
    expect(screen.getByText(`APP.TYPES.${label}`)).toBeInTheDocument()
  })

  describe('create button', () => {
    it('calls onCreate when button is clicked', async () => {
      const user = userEvent.setup()
      const appDetail = createMockAppDetail('chat')
      const mockOnCreate = vi.fn()

      render(<AppInfo appId="test-app-id" appDetail={appDetail} onCreate={mockOnCreate} />)

      await user.click(screen.getByRole('button', { name: 'explore.tryApp.createFromSampleApp' }))
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
