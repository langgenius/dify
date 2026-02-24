import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import Trigger from './trigger'

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [{ provider: 'openai', label: { en_US: 'OpenAI' } }],
  }),
}))

vi.mock('../model-icon', () => ({
  default: () => <div data-testid="model-icon">Icon</div>,
}))

vi.mock('../model-name', () => ({
  default: ({ modelItem }: { modelItem: { model: string } }) => <div>{modelItem.model}</div>,
}))

describe('Trigger', () => {
  const currentProvider = { provider: 'openai', label: { en_US: 'OpenAI' } } as unknown as ComponentProps<typeof Trigger>['currentProvider']
  const currentModel = { model: 'gpt-4' } as unknown as ComponentProps<typeof Trigger>['currentModel']

  it('should render initialized state', () => {
    render(
      <Trigger
        currentProvider={currentProvider}
        currentModel={currentModel}
      />,
    )
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
    expect(screen.getByTestId('model-icon')).toBeInTheDocument()
  })

  it('should render fallback model id when current model is missing', () => {
    render(
      <Trigger
        modelId="gpt-4"
        providerName="openai"
      />,
    )
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
  })
})
