import type { SnippetListItem } from '@/types/snippet'
import { render, screen } from '@testing-library/react'
import SnippetCard from '../snippet-card'

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'creator-id', name: 'Creator', email: 'creator@example.com', avatar: '', avatar_url: null, role: 'editor', last_login_at: '', created_at: '', status: 'active' },
        { id: 'updater-id', name: 'Updater', email: 'updater@example.com', avatar: '', avatar_url: null, role: 'editor', last_login_at: '', created_at: '', status: 'active' },
      ],
    },
  }),
}))

vi.mock('@/utils/time', () => ({
  formatTime: () => 'formatted-time',
}))

const createSnippet = (overrides: Partial<SnippetListItem> = {}): SnippetListItem => ({
  id: 'snippet-1',
  name: 'Tone Rewriter',
  description: 'Rewrites rough drafts.',
  type: 'node',
  is_published: true,
  use_count: 19,
  icon_info: {
    icon_type: 'emoji',
    icon: '🪄',
    icon_background: '#E0EAFF',
    icon_url: '',
  },
  created_at: 1_704_067_200,
  created_by: 'creator-id',
  updated_at: 1_704_153_600,
  updated_by: 'updater-id',
  ...overrides,
})

describe('SnippetCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render updater name and updated time from member data', () => {
      render(<SnippetCard snippet={createSnippet()} />)

      expect(screen.getByText('Tone Rewriter')).toBeInTheDocument()
      expect(screen.getByText('snippet.updatedBy:{"name":"Updater","time":"formatted-time"}')).toBeInTheDocument()
      expect(screen.queryByText('Creator')).not.toBeInTheDocument()
    })

    it('should fall back to creator name when updater is unavailable', () => {
      render(<SnippetCard snippet={createSnippet({ updated_by: 'missing-user' })} />)

      expect(screen.getByText('snippet.updatedBy:{"name":"Creator","time":"formatted-time"}')).toBeInTheDocument()
    })
  })
})
