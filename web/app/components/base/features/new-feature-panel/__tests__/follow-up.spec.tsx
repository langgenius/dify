import type { OnFeaturesChange, SuggestedQuestionsAfterAnswer } from '../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesProvider } from '../../context'
import { FollowUp } from '../follow-up'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModelAndCurrentProviderAndModel: () => ({ defaultModel: undefined }),
}))
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <div>Model selector</div>,
  }),
)

function renderWithProvider(
  props: {
    disabled?: boolean
    onChange?: OnFeaturesChange
    suggested?: SuggestedQuestionsAfterAnswer
  } = {},
) {
  return render(
    <FeaturesProvider features={{ suggested: props.suggested || { enabled: false } }}>
      <FollowUp disabled={props.disabled} onChange={props.onChange} />
    </FeaturesProvider>,
  )
}

describe('FollowUp', () => {
  it('enables the feature before exposing its configuration entry', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProvider({ onChange })
    expect(
      screen.queryByRole('button', { name: 'common.operation.settings' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ suggested: { enabled: true } }))
    expect(screen.getByRole('button', { name: 'common.operation.settings' })).toBeInTheDocument()
  })

  it('discards cancelled drafts and reopens the saved custom prompt', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProvider({ onChange, suggested: { enabled: true, prompt: 'Saved prompt' } })
    const trigger = screen.getByRole('button', { name: 'common.operation.settings' })
    await user.click(trigger)
    const prompt = screen.getByRole('textbox', { name: /modal.customPromptOption/ })
    await user.clear(prompt)
    await user.type(prompt, 'Discard me')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
    await user.click(trigger)
    expect(screen.getByRole('textbox')).toHaveValue('Saved prompt')
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'New prompt')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        suggested: expect.objectContaining({ enabled: true, prompt: 'New prompt' }),
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger)
    expect(screen.getByRole('textbox')).toHaveValue('New prompt')
  })

  it('prevents changes when the feature is readonly', async () => {
    const user = userEvent.setup()
    renderWithProvider({ disabled: true, suggested: { enabled: true } })
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
    const trigger = screen.getByRole('button', { name: 'common.operation.settings' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
