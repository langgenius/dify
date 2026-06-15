import { render, screen } from '@testing-library/react'
import DatasetListHeader from '../header'

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, className }: { children: React.ReactNode, className?: string }) => (
    <button type="button" className={className}>{children}</button>
  ),
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
    <button type="button" className={className} onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: ({ className }: { className?: string }) => <hr data-testid="create-menu-separator" className={className} />,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => render,
}))

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: () => <div data-testid="tag-filter" />,
}))

vi.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  default: () => <label>include all</label>,
}))

vi.mock('../../extra-info/service-api', () => ({
  default: () => <button type="button">service api</button>,
}))

const defaultProps = {
  apiBaseUrl: 'https://api.example.com',
  includeAll: false,
  isCurrentWorkspaceEditor: true,
  isCurrentWorkspaceManager: true,
  isCurrentWorkspaceOwner: true,
  keywords: '',
  tagFilterValue: [],
  onCreateDataset: vi.fn(),
  onCreateFromPipeline: vi.fn(),
  onConnectDataset: vi.fn(),
  onExternalApiClick: vi.fn(),
  onIncludeAllChange: vi.fn(),
  onKeywordsChange: vi.fn(),
  onOpenTagManagement: vi.fn(),
  onTagsChange: vi.fn(),
}

describe('DatasetListHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the updated create menu labels and pipeline icon', () => {
    render(<DatasetListHeader {...defaultProps} />)

    expect(screen.getByRole('button', { name: /dataset\.firstEmpty\.createTitle/ })).toBeInTheDocument()

    const menuItem = screen.getByRole('button', { name: /dataset\.firstEmpty\.pipelineTitle/ })

    expect(menuItem.querySelector('.i-custom-vender-pipeline-pipeline-line')).toBeInTheDocument()
  })
})
