import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { STEP_BY_STEP_TOUR_TARGETS } from '@/app/components/step-by-step-tour/target-registry'
import DatasetListHeader from '../header'

vi.mock('@/features/tag-management/components/tag-filter', () => ({
  TagFilter: () => <div />,
}))

vi.mock('@/app/components/datasets/create/website/base/checkbox-with-label', () => ({
  default: () => <span>include all</span>,
}))

vi.mock('../../extra-info/service-api', () => ({
  ServiceApi: () => <button type="button">service api</button>,
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

  it('shows dataset and pipeline creation actions in the create menu', async () => {
    const user = userEvent.setup()
    render(<DatasetListHeader {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: /common\.operation\.create/ }))

    expect(
      screen.getByRole('menuitem', { name: /dataset\.firstEmpty\.createTitle/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).toBeInTheDocument()
  })

  it('only shows external dataset connection without create permission', async () => {
    const user = userEvent.setup()
    render(<DatasetListHeader {...defaultProps} canCreateDataset={false} />)

    await user.click(screen.getByRole('button', { name: /common\.operation\.create/ }))

    expect(
      screen.queryByRole('menuitem', { name: /dataset\.firstEmpty\.createTitle/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /dataset\.firstEmpty\.pipelineTitle/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /dataset\.connectDataset/ })).toBeInTheDocument()
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

  it('exposes step-by-step tour targets for the create menu walkthrough', () => {
    render(
      <DatasetListHeader
        {...defaultProps}
        stepByStepTourCreateMenuOpen
        stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
        stepByStepTourCreateMenuHighlightPart={
          STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu
        }
      />,
    )

    expect(screen.getByRole('button', { name: /common\.operation\.create/ })).toHaveAttribute(
      'data-step-by-step-tour-target',
      STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate,
    )
    expect(screen.getByText('dataset.firstEmpty.createTitle')).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'dataset.firstEmpty.createTitle', hidden: true }),
    ).toBeInTheDocument()
    const createMenuHighlightPart = document.body.querySelector(
      `[data-step-by-step-tour-highlight-part="${STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu}"]`,
    )
    expect(createMenuHighlightPart).toBeInTheDocument()
    expect(screen.getByRole('menu', { hidden: true })).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps the tour-opened create menu as presentation only', () => {
    render(
      <DatasetListHeader
        {...defaultProps}
        stepByStepTourCreateMenuOpen
        stepByStepTourCreateMenuTarget={STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreate}
        stepByStepTourCreateMenuHighlightPart={
          STEP_BY_STEP_TOUR_TARGETS.knowledgeWithDatasetsCreateMenu
        }
      />,
    )

    fireEvent.click(
      screen.getByRole('menuitem', { name: 'dataset.firstEmpty.createTitle', hidden: true }),
    )

    expect(defaultProps.onCreateDataset).not.toHaveBeenCalled()
  })
})
