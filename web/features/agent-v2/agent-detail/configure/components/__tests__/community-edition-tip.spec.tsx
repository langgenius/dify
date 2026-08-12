import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { CommunityEditionTip } from '../community-edition-tip'

const tip = 'sandbox runs as a non-root user'

describe('CommunityEditionTip', () => {
  it('shows the warning on community edition (self-hosted, non-enterprise)', () => {
    renderWithConsoleQuery(<CommunityEditionTip tip={tip} />, {
      systemFeatures: { deployment_edition: 'COMMUNITY' },
    })

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
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
