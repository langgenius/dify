import { render, screen } from '@testing-library/react'
import { CommunityEditionTip } from '../community-edition-tip'

const edition = vi.hoisted(() => ({ isCommunity: true }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get IS_COMMUNITY_EDITION() {
    return edition.isCommunity
  },
}))

const tip = 'sandbox runs as a non-root user'

describe('CommunityEditionTip', () => {
  it('shows the warning on community edition (self-hosted, non-enterprise)', () => {
    edition.isCommunity = true

    render(<CommunityEditionTip tip={tip} />)

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
  })

  it('renders nothing on an enterprise or cloud deployment', () => {
    // Sandbox isolation is a property of the community build, so the tip is
    // gated on edition alone — not on license or billing state.
    edition.isCommunity = false

    render(<CommunityEditionTip tip={tip} />)

    expect(screen.queryByLabelText(tip)).not.toBeInTheDocument()
  })
})
