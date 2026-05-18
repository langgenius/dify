import type {
  OnFeaturesChange,
  SuggestedQuestionsAfterAnswer,
} from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { FeaturesProvider } from '../../context'
import FollowUp from '../follow-up'

vi.mock('../follow-up-setting-modal', () => ({
  default: ({ onSave, onCancel }: { onSave: (newState: unknown) => void, onCancel: () => void }) => (
    <div data-testid="follow-up-setting-modal">
      <button
        type="button"
        onClick={() => onSave({
          enabled: true,
          prompt: 'test prompt',
          model: {
            provider: 'openai',
            name: 'gpt-4o-mini',
            mode: 'chat',
            completion_params: {
              temperature: 0.7,
              max_tokens: 0,
              top_p: 0,
              echo: false,
              stop: [],
              presence_penalty: 0,
              frequency_penalty: 0,
            },
          },
        })}
      >
        save-settings
      </button>
      <button type="button" onClick={onCancel}>cancel-settings</button>
    </div>
  ),
}))

const renderWithProvider = (
  props: {
    disabled?: boolean
    onChange?: OnFeaturesChange
    suggested?: SuggestedQuestionsAfterAnswer
  } = {},
) => {
  return render(
    <FeaturesProvider features={{
      suggested: props.suggested || { enabled: false },
    }}
    >
      <FollowUp disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('FollowUp', () => {
  it('should render the follow-up feature card', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.title/)).toBeInTheDocument()
  })

  it('should render description text', () => {
    renderWithProvider()

    expect(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.description/)).toBeInTheDocument()
  })

  it('should render a switch toggle', () => {
    renderWithProvider()

    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should call onChange when toggled', () => {
    const onChange = vi.fn()
    renderWithProvider({ onChange })

    fireEvent.click(screen.getByRole('switch'))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('should not throw when onChange is not provided', () => {
    renderWithProvider()

    expect(() => fireEvent.click(screen.getByRole('switch'))).not.toThrow()
  })

  it('should render edit button when enabled and hovering', () => {
    renderWithProvider({
      suggested: {
        enabled: true,
      },
    })

    fireEvent.mouseEnter(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.title/).closest('[class]')!)

    expect(screen.getByText(/operation\.settings/)).toBeInTheDocument()
  })

  it('should open settings modal and save follow-up config', () => {
    const onChange = vi.fn()
    renderWithProvider({
      onChange,
      suggested: {
        enabled: true,
      },
    })

    fireEvent.mouseEnter(screen.getByText(/feature\.suggestedQuestionsAfterAnswer\.title/).closest('[class]')!)
    fireEvent.click(screen.getByText(/operation\.settings/))

    expect(screen.getByTestId('follow-up-setting-modal')).toBeInTheDocument()

    fireEvent.click(screen.getByText('save-settings'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      suggested: expect.objectContaining({
        enabled: true,
        prompt: 'test prompt',
        model: expect.objectContaining({
          provider: 'openai',
          name: 'gpt-4o-mini',
        }),
      }),
    }))
  })
})
