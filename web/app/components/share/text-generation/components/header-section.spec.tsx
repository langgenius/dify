import type { SavedMessage } from '@/models/debug'
import type { SiteInfo } from '@/models/share'
import { fireEvent, render, screen } from '@testing-library/react'
import { AccessMode } from '@/models/access-control'
import HeaderSection from './header-section'

// Mock menu-dropdown (sibling with external deps)
vi.mock('../menu-dropdown', () => ({
  default: ({ hideLogout, data }: { hideLogout: boolean, data: SiteInfo }) => (
    <div data-testid="menu-dropdown" data-hide-logout={String(hideLogout)}>{data.title}</div>
  ),
}))

const baseSiteInfo: SiteInfo = {
  title: 'Test App',
  icon_type: 'emoji',
  icon: '🤖',
  icon_background: '#eee',
  icon_url: '',
  description: 'A description',
  default_language: 'en-US',
  prompt_public: false,
  copyright: '',
  privacy_policy: '',
  custom_disclaimer: '',
  show_workflow_steps: false,
  use_icon_as_answer_icon: false,
  chat_color_theme: '',
}

const defaultProps = {
  isPC: true,
  isInstalledApp: false,
  isWorkflow: false,
  siteInfo: baseSiteInfo,
  accessMode: AccessMode.PUBLIC,
  savedMessages: [] as SavedMessage[],
  currentTab: 'create',
  onTabChange: vi.fn(),
}

describe('HeaderSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Basic rendering
  describe('Rendering', () => {
    it('should render app title and description', () => {
      render(<HeaderSection {...defaultProps} />)

      // MenuDropdown mock also renders title, so use getAllByText
      expect(screen.getAllByText('Test App').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('A description')).toBeInTheDocument()
    })

    it('should not render description when empty', () => {
      render(<HeaderSection {...defaultProps} siteInfo={{ ...baseSiteInfo, description: '' }} />)

      expect(screen.queryByText('A description')).not.toBeInTheDocument()
    })
  })

  // Tab rendering
  describe('Tabs', () => {
    it('should render create and batch tabs', () => {
      render(<HeaderSection {...defaultProps} />)

      expect(screen.getByText(/share\.generation\.tabs\.create/)).toBeInTheDocument()
      expect(screen.getByText(/share\.generation\.tabs\.batch/)).toBeInTheDocument()
    })

    it('should render saved tab when not workflow', () => {
      render(<HeaderSection {...defaultProps} isWorkflow={false} />)

      expect(screen.getByText(/share\.generation\.tabs\.saved/)).toBeInTheDocument()
    })

    it('should hide saved tab when isWorkflow is true', () => {
      render(<HeaderSection {...defaultProps} isWorkflow />)

      expect(screen.queryByText(/share\.generation\.tabs\.saved/)).not.toBeInTheDocument()
    })

    it('should show badge count for saved messages', () => {
      const messages: SavedMessage[] = [
        { id: '1', answer: 'a' } as SavedMessage,
        { id: '2', answer: 'b' } as SavedMessage,
      ]
      render(<HeaderSection {...defaultProps} savedMessages={messages} />)

      expect(screen.getByText('2')).toBeInTheDocument()
    })
  })

  // Menu dropdown
  describe('MenuDropdown', () => {
    it('should pass hideLogout=true when accessMode is PUBLIC', () => {
      render(<HeaderSection {...defaultProps} accessMode={AccessMode.PUBLIC} />)

      expect(screen.getByTestId('menu-dropdown')).toHaveAttribute('data-hide-logout', 'true')
    })

    it('should pass hideLogout=true when isInstalledApp', () => {
      render(<HeaderSection {...defaultProps} isInstalledApp={true} accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS} />)

      expect(screen.getByTestId('menu-dropdown')).toHaveAttribute('data-hide-logout', 'true')
    })

    it('should pass hideLogout=false when not installed and accessMode is not PUBLIC', () => {
      render(<HeaderSection {...defaultProps} isInstalledApp={false} accessMode={AccessMode.SPECIFIC_GROUPS_MEMBERS} />)

      expect(screen.getByTestId('menu-dropdown')).toHaveAttribute('data-hide-logout', 'false')
    })
  })

  // Tab change callback
  describe('Interaction', () => {
    it('should call onTabChange when a tab is clicked', () => {
      const onTabChange = vi.fn()
      render(<HeaderSection {...defaultProps} onTabChange={onTabChange} />)

      fireEvent.click(screen.getByText(/share\.generation\.tabs\.batch/))

      expect(onTabChange).toHaveBeenCalledWith('batch')
    })
  })
})
