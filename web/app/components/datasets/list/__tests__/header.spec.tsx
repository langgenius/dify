import { render, screen } from '@testing-library/react'
import DatasetListHeader from '../header'

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => render,
}))

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: () => <div />,
}))

vi.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  default: () => <span>include all</span>,
}))

vi.mock('../../extra-info/service-api', () => ({
  default: () => <button type="button">service api</button>,
}))

const defaultProps = {
  apiBaseUrl: 'https://api.example.com',
  canConnectExternalDataset: true,
  canCreateDataset: true,
  includeAll: false,
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
  it('hides dataset creation actions without create permission', () => {
    render(<DatasetListHeader {...defaultProps} canCreateDataset={false} />)

    expect(
      screen.queryByRole('button', { name: /dataset\.firstEmpty\.createTitle/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dataset\.connectDataset/ })).toBeInTheDocument()
  })

  it('hides the external API entry without external-connect permission', () => {
    render(<DatasetListHeader {...defaultProps} canConnectExternalDataset={false} />)

    expect(
      screen.queryByRole('button', { name: /dataset\.externalAPIPanelTitle/ }),
    ).not.toBeInTheDocument()
  })

  it('hides the create menu when no creation action is available', () => {
    render(
      <DatasetListHeader
        {...defaultProps}
        canConnectExternalDataset={false}
        canCreateDataset={false}
      />,
    )

    expect(
      screen.queryByRole('button', { name: /common\.operation\.create/ }),
    ).not.toBeInTheDocument()
  })
})
