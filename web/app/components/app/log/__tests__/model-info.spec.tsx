import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModelInfo from '../model-info'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentModel: {
      model: 'gpt-4',
      model_display_name: 'GPT-4',
    },
    currentProvider: {
      provider: 'openai',
      label: 'OpenAI',
    },
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-icon', () => ({
  default: ({ modelName }: { provider: unknown; modelName: string }) => (
    <div data-testid="model-icon" data-model-name={modelName}>
      ModelIcon
    </div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-name', () => ({
  default: ({ modelItem, showMode }: { modelItem: { model: string }; showMode: boolean }) => (
    <div data-testid="model-name" data-show-mode={showMode ? 'true' : 'false'}>
      {modelItem?.model}
    </div>
  ),
}))

it('reveals the recorded parameters and preserves zero and multiple stop values', async () => {
  const user = userEvent.setup()
  render(
    <ModelInfo
      model={{
        name: 'gpt-4',
        provider: 'openai',
        completion_params: {
          temperature: 0,
          top_p: 0.9,
          presence_penalty: 0.1,
          max_tokens: 2048,
          stop: ['END', 'STOP'],
        },
      }}
    />,
  )
  expect(screen.queryByText(/detail\.modelParams$/)).not.toBeInTheDocument()
  const trigger = screen.getByRole('button')
  await user.click(trigger)
  for (const [label, value] of [
    ['Temperature', '0'],
    ['Top P', '0.9'],
    ['Presence Penalty', '0.1'],
    ['Max Token', '2048'],
    ['Stop', 'END,STOP'],
  ]) {
    expect(screen.getByText(label!).parentElement).toHaveTextContent(value!)
  }
  await user.click(trigger)
  expect(screen.queryByText(/detail\.modelParams$/)).not.toBeInTheDocument()
})

it.each([undefined, {}, { stop: 'invalid', temperature: null }])(
  'shows fallback values for unavailable parameters: %j',
  async (completion_params) => {
    const user = userEvent.setup()
    render(<ModelInfo model={{ name: 'gpt-4', provider: 'openai', completion_params }} />)
    await user.click(screen.getByRole('button'))
    for (const label of ['Temperature', 'Top P', 'Presence Penalty', 'Max Token', 'Stop']) {
      expect(within(screen.getByText(label).parentElement!).getByText('-')).toBeInTheDocument()
    }
  },
)
