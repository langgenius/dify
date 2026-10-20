import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { CommunityEditionTip } from '../community-edition-tip'

const tip = 'sandbox runs as a non-root user'

describe('CommunityEditionTip', () => {
  it('discloses the warning on community edition (self-hosted, non-enterprise)', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(<CommunityEditionTip tip={tip} />, {
      systemFeatures: { deployment_edition: 'COMMUNITY' },
    })

    await user.click(screen.getByRole('button', { name: tip }))
    expect(await screen.findByText(tip)).toBeVisible()
  })

  it.each(['ENTERPRISE', 'CLOUD'] as const)(
    'renders nothing when deployment edition is %s',
    (deploymentEdition) => {
      renderWithConsoleQuery(<CommunityEditionTip tip={tip} />, {
        systemFeatures: { deployment_edition: deploymentEdition },
      })

      expect(screen.queryByLabelText(tip)).not.toBeInTheDocument()
    },
  )
})
