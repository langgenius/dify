import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UsageInfo from '../index'

const storageProps = {
  iconClassName: 'i-ri-hard-drive-3-line',
  name: 'Knowledge Data Storage',
  tooltip: 'High quality documents use storage.',
  storageTooltip: 'Detailed usage is shown once storage exceeds 50 MB.',
  usage: 20,
  total: 50,
  unit: 'MB',
  storageMode: true,
  isSandboxPlan: true,
}

describe('UsageInfo storage explanation', () => {
  it('makes both storage explanations available from the keyboard help entry', async () => {
    const user = userEvent.setup()
    render(<UsageInfo {...storageProps} />)

    await user.tab()
    expect(screen.getByRole('button', { name: storageProps.name })).toHaveFocus()
    await user.keyboard('{Enter}')

    const explanation = await screen.findByRole('dialog', { name: storageProps.name })
    expect(within(explanation).getByText(storageProps.tooltip)).toBeVisible()
    expect(within(explanation).getByText(storageProps.storageTooltip)).toBeVisible()
  })

  it('keeps general storage help without a threshold claim when usage is unknown', async () => {
    const user = userEvent.setup()
    render(<UsageInfo {...storageProps} usageUnknown />)

    await user.click(screen.getByRole('button', { name: storageProps.name }))

    const explanation = await screen.findByRole('dialog', { name: storageProps.name })
    expect(within(explanation).getByText(storageProps.tooltip)).toBeVisible()
    expect(within(explanation).queryByText(storageProps.storageTooltip)).not.toBeInTheDocument()
    expect(screen.getByText('--')).toBeVisible()
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
  })
})
