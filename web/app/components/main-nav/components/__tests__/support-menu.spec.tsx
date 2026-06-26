import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
import { render, screen } from '@testing-library/react'
import SupportMenu from '../support-menu'

describe('SupportMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderSupportMenu = () => {
    return render(
      <DropdownMenu open={true} onOpenChange={() => { }}>
        <DropdownMenuTrigger>open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <SupportMenu />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
  }

  it('renders support entries as flat main nav help menu items', () => {
    renderSupportMenu()

    expect(screen.queryByText('common.userProfile.contactUs')).not.toBeInTheDocument()
    expect(screen.getByText('common.userProfile.forum')).toBeInTheDocument()
    expect(screen.getByText('common.userProfile.community')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'common.userProfile.forum' })).toHaveClass('mx-0', 'px-3')
  })

  it('has correct forum and community links', () => {
    renderSupportMenu()

    const forumLink = screen.getByText('common.userProfile.forum').closest('a')
    const communityLink = screen.getByText('common.userProfile.community').closest('a')
    expect(forumLink).toHaveAttribute('href', 'https://forum.dify.ai/')
    expect(communityLink).toHaveAttribute('href', 'https://discord.gg/5AEfbxcd9k')
  })
})
