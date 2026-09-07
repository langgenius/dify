import type { ComponentProps } from 'react'
import type { ModelParameterModalProps } from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentModelField } from '../field'

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: ({ setModel }: Pick<ModelParameterModalProps, 'setModel'>) => (
      <button
        type="button"
        onClick={() =>
          setModel({
            modelId: 'claude-sonnet-4-5',
            provider: 'langgenius/anthropic/anthropic',
            plugin_id: 'langgenius/anthropic',
          })
        }
      >
        Select Anthropic
      </button>
    ),
  }),
)

describe('AgentModelField', () => {
  it('replaces model-owned fields when selecting a model from another provider', () => {
    const onSelect = vi.fn()
    const currentModel: ComponentProps<typeof AgentModelField>['currentModel'] = {
      provider: 'langgenius/openai/openai',
      model: 'gpt-4.1',
      plugin_id: 'langgenius/openai',
      model_settings: { temperature: 0.7 },
    }

    render(
      <AgentModelField
        currentModel={currentModel}
        textGenerationModelList={[]}
        onSelect={onSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select Anthropic' }))

    expect(onSelect).toHaveBeenCalledWith({
      provider: 'langgenius/anthropic/anthropic',
      model: 'claude-sonnet-4-5',
      plugin_id: 'langgenius/anthropic',
    })
  })
})
