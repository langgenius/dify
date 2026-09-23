import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type {
  DefaultModelDataResponse,
  SimpleProviderEntityResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtom, useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  agentComposerSavedDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { AgentConfigureComposerProvider } from '../composer-provider'

const mocks = vi.hoisted(() => ({
  getDefaultModel: vi.fn<() => Promise<DefaultModelDataResponse>>(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        defaultModel: {
          get: {
            queryOptions: ({ enabled }: { enabled: boolean }) => ({
              queryKey: ['default-model'],
              queryFn: mocks.getDefaultModel,
              enabled,
            }),
          },
        },
      },
    },
  },
}))

function ModelEditor() {
  const [model, setModel] = useAtom(agentComposerModelAtom)
  const savedDraft = useAtomValue(agentComposerSavedDraftAtom)
  const isDirty = useAtomValue(isAgentComposerDirtyAtom)

  return (
    <div>
      <label>
        Model
        <input
          value={model?.model ?? ''}
          onChange={(event) =>
            setModel({ provider: 'langgenius/openai/openai', model: event.target.value })
          }
        />
      </label>
      <output aria-label="Saved model">{savedDraft?.model?.model ?? 'None'}</output>
      <output aria-label="Unsaved changes">{String(isDirty)}</output>
    </div>
  )
}

function renderComposer(initialConfig: AgentSoulConfig = {}, initializeDefaultModel = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <AgentConfigureComposerProvider
        initialConfig={initialConfig}
        initializeDefaultModel={initializeDefaultModel}
      >
        <ModelEditor />
      </AgentConfigureComposerProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

const provider: SimpleProviderEntityResponse = {
  provider: 'langgenius/openai/openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: ['llm'],
  tenant_id: 'workspace-1',
}

const defaultModel: DefaultModelDataResponse = {
  data: { model: 'gpt-4o-mini', model_type: 'llm', provider },
}

describe('Agent configure default model initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDefaultModel.mockResolvedValue(defaultModel)
  })

  it('waits for the default before exposing an editable draft and preserves the unsaved baseline', async () => {
    let resolve!: (value: DefaultModelDataResponse) => void
    mocks.getDefaultModel.mockReturnValue(
      new Promise((promiseResolve) => {
        resolve = promiseResolve
      }),
    )
    renderComposer()

    expect(screen.queryByRole('textbox', { name: 'Model' })).not.toBeInTheDocument()

    await act(async () => resolve(defaultModel))

    expect(await screen.findByRole('textbox', { name: 'Model' })).toHaveValue('gpt-4o-mini')
    expect(screen.getByLabelText('Saved model')).toHaveTextContent('None')
    expect(screen.getByLabelText('Unsaved changes')).toHaveTextContent('true')
  })

  it('preserves an explicitly configured model without fetching the default', () => {
    renderComposer({
      model: {
        model: 'configured-model',
        model_provider: 'openai',
        plugin_id: 'langgenius/openai',
      },
    })

    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('configured-model')
    expect(screen.getByLabelText('Saved model')).toHaveTextContent('configured-model')
    expect(screen.getByLabelText('Unsaved changes')).toHaveTextContent('false')
    expect(mocks.getDefaultModel).not.toHaveBeenCalled()
  })

  it('leaves model-less configurations unchanged when initialization is disabled', () => {
    renderComposer({}, false)

    expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('')
    expect(screen.getByLabelText('Unsaved changes')).toHaveTextContent('false')
    expect(mocks.getDefaultModel).not.toHaveBeenCalled()
  })

  it.each(['missing', 'error'] as const)(
    'allows manual selection when the default is %s',
    async (result) => {
      const user = userEvent.setup()
      if (result === 'missing') mocks.getDefaultModel.mockResolvedValue({ data: null })
      else mocks.getDefaultModel.mockRejectedValue(new Error('Default model unavailable'))
      renderComposer()

      const input = await screen.findByRole('textbox', { name: 'Model' })
      expect(input).toHaveValue('')
      await user.type(input, 'manual-model')

      expect(input).toHaveValue('manual-model')
      expect(screen.getByLabelText('Unsaved changes')).toHaveTextContent('true')
    },
  )

  it('preserves the user selection when another consumer refreshes the default model', async () => {
    const user = userEvent.setup()
    const queryClient = renderComposer()
    const input = await screen.findByRole('textbox', { name: 'Model' })
    await user.clear(input)
    await user.type(input, 'manual-model')

    mocks.getDefaultModel.mockResolvedValue({
      data: { model: 'new-default', model_type: 'llm', provider },
    })
    await act(async () => {
      await queryClient.query({ queryKey: ['default-model'], queryFn: mocks.getDefaultModel })
    })

    expect(input).toHaveValue('manual-model')
    expect(screen.getByLabelText('Saved model')).toHaveTextContent('None')
    expect(screen.getByLabelText('Unsaved changes')).toHaveTextContent('true')
  })
})
