import type {
  FormValue,
  ModelParameterRule,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import LLMParamsPanel from '../llm-params-panel'

const getRules = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.parameterRules.get': getRules,
    }),
  }
})

const rule = (name = 'temperature'): ModelParameterRule => ({
  name,
  label: { en_US: name, zh_Hans: name },
  type: 'float',
  default: 0.7,
  min: 0,
  max: 2,
  precision: 2,
  required: false,
})
const defaults = {
  isAdvancedMode: false,
  provider: 'langgenius/openai/openai',
  modelId: 'gpt-4',
  completionParams: {},
  onCompletionParamsChange: vi.fn(),
}
const presetsButton = 'modelProvider.modelProvider.loadPresets'

beforeEach(() => {
  vi.clearAllMocks()
  getRules.mockResolvedValue({ data: [rule()] })
})

describe('LLM parameter panel', () => {
  it('loads rules for each model and replaces stale inputs when switching models', async () => {
    const first = createDeferred<{ data: ModelParameterRule[] }>()
    const second = createDeferred<{ data: ModelParameterRule[] }>()
    getRules.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { rerender } = renderWithConsoleQuery(<LLMParamsPanel {...defaults} />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    first.resolve({ data: [rule()] })
    expect(await screen.findByRole('spinbutton', { name: 'temperature' })).toHaveValue(0.7)
    expect(getRules).toHaveBeenCalledWith({
      params: { provider: defaults.provider },
      query: { model: 'gpt-4' },
    })
    rerender(<LLMParamsPanel {...defaults} modelId="new-model" />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'temperature' })).not.toBeInTheDocument()
    second.resolve({ data: [rule('top_p')] })
    expect(await screen.findByRole('spinbutton', { name: 'top_p' })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'temperature' })).not.toBeInTheDocument()
    expect(getRules).toHaveBeenLastCalledWith({
      params: { provider: defaults.provider },
      query: { model: 'new-model' },
    })
  })

  it('does not request rules or show a loading spinner without a model', () => {
    renderWithConsoleQuery(<LLMParamsPanel {...defaults} provider="" modelId="" />)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText('modelProvider.modelProvider.parameters')).toBeInTheDocument()
    expect(getRules).not.toHaveBeenCalled()
  })

  it.each([
    { provider: 'langgenius/openai/openai', names: ['max_tokens'] },
    { provider: 'anthropic/claude', names: ['temperature'] },
    { provider: 'langgenius/openai/openai', names: [] },
  ])('hides presets for $provider with $names rules', async ({ provider, names }) => {
    getRules.mockResolvedValue({ data: names.map((name) => rule(name)) })
    renderWithConsoleQuery(<LLMParamsPanel {...defaults} provider={provider} />)
    await screen.findByText('modelProvider.modelProvider.parameters')
    expect(screen.queryByRole('button', { name: presetsButton })).not.toBeInTheDocument()
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(names.length)
  })

  it('applies a preset through the real menu while preserving unrelated parameters', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    getRules.mockResolvedValue({
      data: ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty'].map((name) =>
        rule(name),
      ),
    })
    renderWithConsoleQuery(
      <LLMParamsPanel
        {...defaults}
        completionParams={{ existing: 'value', temperature: 0.1 }}
        onCompletionParamsChange={onChange}
      />,
    )
    await user.click(await screen.findByRole('button', { name: presetsButton }))
    await user.click(await screen.findByRole('menuitem', { name: 'common.model.tone.Creative' }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      existing: 'value',
      temperature: 0.8,
      top_p: 0.9,
      presence_penalty: 0.1,
      frequency_penalty: 0.1,
    })
  })

  it.each(['langgenius/openai/openai', 'langgenius/azure_openai/azure_openai'])(
    'only applies supported preset parameters for %s',
    async (provider) => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      renderWithConsoleQuery(
        <LLMParamsPanel
          {...defaults}
          provider={provider}
          completionParams={{ max_tokens: 100 }}
          onCompletionParamsChange={onChange}
        />,
      )
      await user.click(await screen.findByRole('button', { name: presetsButton }))
      await user.click(await screen.findByRole('menuitem', { name: 'common.model.tone.Balanced' }))
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ max_tokens: 100, temperature: 0.5 })
    },
  )

  it('enables a parameter with its default, edits it, and removes it without losing other values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function ControlledPanel() {
      const [value, setValue] = useState<FormValue>({ max_tokens: 100 })
      return (
        <LLMParamsPanel
          {...defaults}
          completionParams={value}
          onCompletionParamsChange={(next) => {
            onChange(next)
            setValue(next)
          }}
        />
      )
    }
    renderWithConsoleQuery(<ControlledPanel />)
    const toggle = await screen.findByRole('switch', { name: 'temperature' })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith({ max_tokens: 100, temperature: 0.7 })
    expect(toggle).toBeChecked()
    const input = screen.getByRole('spinbutton', { name: 'temperature' })
    await user.clear(input)
    await user.type(input, '0.5')
    expect(onChange).toHaveBeenLastCalledWith({ max_tokens: 100, temperature: 0.5 })
    await user.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith({ max_tokens: 100 })
    expect(toggle).not.toBeChecked()
  })

  it('adds stop sequences only in advanced mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = renderWithConsoleQuery(
      <LLMParamsPanel {...defaults} onCompletionParamsChange={onChange} />,
    )
    await screen.findByRole('spinbutton', { name: 'temperature' })
    expect(screen.queryByText('Stop sequences')).not.toBeInTheDocument()
    rerender(
      <LLMParamsPanel
        {...defaults}
        isAdvancedMode
        completionParams={{ temperature: 0.5 }}
        onCompletionParamsChange={onChange}
      />,
    )
    await user.type(
      screen.getByPlaceholderText('common.model.params.stop_sequencesPlaceholder'),
      'END{Tab}',
    )
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ temperature: 0.5, stop: ['END'] }),
    )
  })
})
