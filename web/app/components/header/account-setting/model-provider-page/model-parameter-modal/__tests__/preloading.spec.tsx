import type { ParameterRule } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { ModelParameterModalProps } from '../index'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createTestQueryClient } from '@/test/query-client'
import ModelParameterModal from '../index'

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: mockRequest,
}))

vi.mock('../../hooks', () => ({
  useLanguage: () => 'en_US',
  useTextGenerationCurrentProviderAndModelAndModelList: ({
    provider,
    model,
  }: {
    provider: string
    model: string
  }) => ({
    currentProvider: { provider },
    currentModel: { model, status: 'active' },
    activeTextGenerationModelList: [],
  }),
}))

vi.mock('../../model-selector', () => {
  const ModelSelector = () => <button type="button">Select model</button>
  return { ModelSelector, SplitModelSelector: ModelSelector }
})

const temperatureRule: ParameterRule = {
  name: 'temperature',
  label: { en_US: 'Temperature', zh_Hans: '温度' },
  type: 'float',
  default: 0.7,
  min: 0,
  max: 1,
  required: false,
}

const defaultProps: ModelParameterModalProps = {
  isAdvancedMode: false,
  provider: 'openai',
  modelId: 'gpt-3.5-turbo',
  completionParams: { temperature: 0.7 },
  setModel: vi.fn(),
  onCompletionParamsChange: vi.fn(),
  hideDebugWithMultipleModel: true,
}

const renderModal = (props: ModelParameterModalProps = defaultProps) => {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { ...render(<ModelParameterModal {...props} />, { wrapper }), queryClient }
}

const getParameterRulesQueryKey = (provider: string, model: string) =>
  consoleQuery.workspaces.current.modelProviders.byProvider.models.parameterRules.get.queryKey({
    input: { params: { provider }, query: { model } },
  })

beforeEach(() => {
  mockRequest.mockReset()
  mockRequest.mockImplementation(async () => Response.json({ data: [temperatureRule] }))
})

describe('Model parameter preloading', () => {
  it.each(['default', 'custom'] as const)(
    'preloads rules before opening the %s trigger and keeps them current after closing',
    async (triggerType) => {
      const user = userEvent.setup()
      const trigger =
        triggerType === 'custom' ? <button type="button">Open debug settings</button> : undefined
      const { queryClient } = renderModal({
        ...defaultProps,
        trigger,
        hideDebugWithMultipleModel: triggerType !== 'custom',
      })
      const queryKey = getParameterRulesQueryKey('openai', 'gpt-3.5-turbo')
      const settingsButton = screen.getByRole('button', {
        name:
          triggerType === 'custom'
            ? 'Open debug settings'
            : 'modelProvider.modelProvider.modelSettings',
      })

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledWith(
          expect.stringContaining(
            '/workspaces/current/model-providers/openai/models/parameter-rules?model=gpt-3.5-turbo',
          ),
          expect.anything(),
          expect.objectContaining({ fetchCompat: true, silent: true }),
        )
        expect(queryClient.getQueryData(queryKey)).toEqual({ data: [temperatureRule] })
      })

      await user.click(settingsButton)
      expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.7)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(mockRequest).toHaveBeenCalledTimes(1)

      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'common.operation.close' }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

      await act(async () => {
        await queryClient.invalidateQueries({ queryKey })
      })
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      await user.click(settingsButton)
      expect(screen.getByRole('spinbutton', { name: 'Temperature' })).toHaveValue(0.7)
      expect(mockRequest).toHaveBeenCalledTimes(2)
    },
  )

  it('preloads a changed model while closed and opens with its rules', async () => {
    const user = userEvent.setup()
    const { queryClient, rerender } = renderModal()
    await waitFor(() => {
      expect(
        queryClient.getQueryData(getParameterRulesQueryKey('openai', 'gpt-3.5-turbo')),
      ).toEqual({ data: [temperatureRule] })
    })

    const maxTokensRule: ParameterRule = {
      name: 'max_tokens',
      label: { en_US: 'Max tokens', zh_Hans: '最大令牌数' },
      type: 'int',
      default: 256,
      required: false,
    }
    mockRequest.mockImplementation(async () => Response.json({ data: [maxTokensRule] }))
    rerender(
      <ModelParameterModal
        {...defaultProps}
        provider="anthropic"
        modelId="claude-sonnet-4"
        completionParams={{ max_tokens: 512 }}
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockRequest).toHaveBeenLastCalledWith(
        expect.stringContaining(
          '/workspaces/current/model-providers/anthropic/models/parameter-rules?model=claude-sonnet-4',
        ),
        expect.anything(),
        expect.objectContaining({ fetchCompat: true, silent: true }),
      )
      expect(
        queryClient.getQueryData(getParameterRulesQueryKey('anthropic', 'claude-sonnet-4')),
      ).toEqual({ data: [maxTokensRule] })
    })

    await user.click(
      screen.getByRole('button', { name: 'modelProvider.modelProvider.modelSettings' }),
    )
    expect(screen.getByRole('spinbutton', { name: 'Max tokens' })).toHaveValue(512)
    expect(screen.queryByRole('spinbutton', { name: 'Temperature' })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })
})
