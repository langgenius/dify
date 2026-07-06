import { fireEvent, render, screen } from '@testing-library/react'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import DatasetListHeader from '../header'

vi.mock('@langgenius/dify-ui/button', () => ({
  Button: ({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" className={className} {...props}>{children}</button>
  ),
}))

vi.mock('@langgenius/dify-ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({
    children,
    popupProps,
    positionerProps,
  }: {
    children: React.ReactNode
    popupProps?: React.HTMLAttributes<HTMLDivElement>
    positionerProps?: React.HTMLAttributes<HTMLDivElement>
  }) => (
    <div {...positionerProps}>
      <div role="menu" {...popupProps}>{children}</div>
    </div>
  ),
  DropdownMenuItem: ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => (
    <button type="button" role="menuitem" className={className} onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: ({ className }: { className?: string }) => <hr data-testid="create-menu-separator" className={className} />,
  DropdownMenuTrigger: ({ render }: { render: React.ReactNode }) => render,
}))

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: () => <div data-testid="tag-filter" />,
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the updated create menu labels and pipeline icon', () => {
    render(<DatasetListHeader {...defaultProps} />)

    expect(screen.getByRole('menuitem', { name: /dataset\.firstEmpty\.createTitle/ })).toBeInTheDocument()

    const menuItem = screen.getByRole('menuitem', { name: /dataset\.firstEmpty\.pipelineTitle/ })

    expect(menuItem.querySelector('.i-custom-vender-pipeline-pipeline-line')).toBeInTheDocument()
  })

  it('should hide dataset creation actions when dataset.create_and_management is unavailable', () => {
    render(<DatasetListHeader {...defaultProps} canCreateDataset={false} />)

    expect(screen.queryByRole('menuitem', { name: /dataset\.firstEmpty\.createTitle/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /dataset\.firstEmpty\.pipelineTitle/ })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /dataset\.connectDataset/ })).toBeInTheDocument()
  })

  it('should hide external API panel entry when dataset.external.connect is unavailable', () => {
    render(<DatasetListHeader {...defaultProps} canConnectExternalDataset={false} />)

    expect(screen.queryByRole('button', { name: /dataset\.externalAPIPanelTitle/ })).not.toBeInTheDocument()
  })

  it('should hide the create menu when no creation or connection action is available', () => {
    render((
      <DatasetListHeader
        {...defaultProps}
        canConnectExternalDataset={false}
        canCreateDataset={false}
      />
    ))

    expect(screen.queryByRole('button', { name: /common\.operation\.create/ })).not.toBeInTheDocument()
  })

  it('exposes step-by-step tour targets for the create menu walkthrough', () => {
    render((
      <DatasetListHeader
        {...defaultProps}
        stepByStepTourCreateMenuOpen
        stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
        stepByStepTourCreateMenuHighlightPart={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu}
      />
    ))

    expect(screen.getByRole('button', { name: /common\.operation\.create/ }))
      .toHaveAttribute('data-step-by-step-tour-target', STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate)
    expect(screen.getByText('dataset.firstEmpty.createTitle')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'dataset.firstEmpty.createTitle', hidden: true })).toBeInTheDocument()
    const createMenuHighlightPart = document.body.querySelector(`[data-step-by-step-tour-highlight-part="${STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu}"]`)
    expect(createMenuHighlightPart).toBeInTheDocument()
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps the tour-opened create menu as presentation only', () => {
    render((
      <DatasetListHeader
        {...defaultProps}
        stepByStepTourCreateMenuOpen
        stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
        stepByStepTourCreateMenuHighlightPart={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu}
      />
    ))

    fireEvent.click(screen.getByRole('menuitem', { name: 'dataset.firstEmpty.createTitle', hidden: true }))

    expect(defaultProps.onCreateDataset).not.toHaveBeenCalled()
  })
})
