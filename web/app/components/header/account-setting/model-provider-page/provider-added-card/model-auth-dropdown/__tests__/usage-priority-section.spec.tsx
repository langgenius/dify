import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreferredProviderTypeEnum } from '../../../declarations'
import UsagePrioritySection from '../usage-priority-section'

describe('UsagePrioritySection', () => {
  const onSelect = vi.fn()
  const getAiCreditsButton = () => screen.getByRole('button', { name: /aiCreditsOption/ })
  const getApiKeyButton = () => screen.getByRole('button', { name: /apiKeyOption/ })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reflects the selected priority and reports a new selection', async () => {
    const user = userEvent.setup()
    render(<UsagePrioritySection value="credits" onSelect={onSelect} />)

    expect(getAiCreditsButton()).toHaveAttribute('aria-pressed', 'true')
    expect(getApiKeyButton()).toHaveAttribute('aria-pressed', 'false')

    await user.click(getApiKeyButton())

    expect(onSelect).toHaveBeenCalledWith(PreferredProviderTypeEnum.custom)
  })
})
