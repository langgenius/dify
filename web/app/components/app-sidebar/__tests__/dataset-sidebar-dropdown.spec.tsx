import type { DataSet } from '@/models/datasets'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import DatasetSidebarDropdown from '../dataset-sidebar-dropdown'

let mockDataset: DataSet

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (selector: (state: { dataset: DataSet }) => unknown) =>
    selector({ dataset: mockDataset }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetRelatedApps: () => ({ data: [] }),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: () => 'method-text',
  }),
}))

vi.mock('@/app/components/base/ui/dropdown-menu', () => {
  const DropdownMenuContext = React.createContext<{ isOpen: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <DropdownMenuContext value={{ isOpen: open, setOpen: onOpenChange ?? vi.fn() }}>
        <div data-testid="dropdown-menu" data-open={open}>{children}</div>
      </DropdownMenuContext>
    ),
    DropdownMenuTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: React.MouseEventHandler<HTMLButtonElement> }) => {
      const { isOpen, setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          data-testid="dropdown-trigger"
          onClick={(e) => {
            onClick?.(e)
            setOpen(!isOpen)
          }}
        >
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdown-content">{children}</div>,
  }
})

vi.mock('../../base/app-icon', () => ({
  default: ({ size, icon }: { size: string, icon: string }) => (
    <div data-testid="app-icon" data-size={size} data-icon={icon} />
  ),
}))

vi.mock('../../base/divider', () => ({
  default: () => <hr data-testid="divider" />,
}))

vi.mock('../../base/effect', () => ({
  default: ({ className }: { className?: string }) => <div data-testid="effect" className={className} />,
}))

vi.mock('../../datasets/extra-info', () => ({
  default: ({ expand, documentCount }: {
    relatedApps?: unknown[]
    expand: boolean
    documentCount: number
  }) => (
    <div data-testid="extra-info" data-expand={expand} data-doc-count={documentCount} />
  ),
}))

vi.mock('../dataset-info/dropdown', () => ({
  default: ({ expand }: { expand: boolean }) => (
    <div data-testid="dataset-dropdown" data-expand={expand} />
  ),
}))

vi.mock('../nav-link', () => ({
  default: ({ name, href, mode, disabled }: { name: string, href: string, mode?: string, disabled?: boolean }) => (
    <a data-testid={`nav-link-${name}`} href={href} data-mode={mode} data-disabled={disabled}>{name}</a>
  ),
}))

const MockIcon = (props: React.SVGProps<SVGSVGElement>) => <svg {...props} />

const createDataset = (overrides: Partial<DataSet> = {}): DataSet => ({
  id: 'dataset-1',
  name: 'Test Dataset',
  description: 'A test dataset',
  provider: 'internal',
  icon_info: {
    icon: '📙',
    icon_type: 'emoji',
    icon_background: '#FFF4ED',
    icon_url: '',
  },
  doc_form: 'text_model' as DataSet['doc_form'],
  indexing_technique: 'high_quality' as DataSet['indexing_technique'],
  document_count: 10,
  runtime_mode: 'general',
  retrieval_model_dict: {
    search_method: 'semantic_search' as DataSet['retrieval_model_dict']['search_method'],
    reranking_enable: false,
    reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
    top_k: 5,
    score_threshold_enabled: false,
    score_threshold: 0,
  },
  ...overrides,
} as DataSet)

const navigation = [
  { name: 'Documents', href: '/documents', icon: MockIcon, selectedIcon: MockIcon },
  { name: 'Settings', href: '/settings', icon: MockIcon, selectedIcon: MockIcon, disabled: true },
]

describe('DatasetSidebarDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDataset = createDataset()
  })

  it('should render trigger with dataset icon', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    const icons = screen.getAllByTestId('app-icon')
    const smallIcon = icons.find(i => i.getAttribute('data-size') === 'small')
    expect(smallIcon).toBeInTheDocument()
    expect(smallIcon).toHaveAttribute('data-icon', '📙')
  })

  it('should display dataset name in dropdown content', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('Test Dataset')).toBeInTheDocument()
  })

  it('should display dataset description', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('A test dataset')).toBeInTheDocument()
  })

  it('should not display description when empty', () => {
    mockDataset = createDataset({ description: '' })
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.queryByText('A test dataset')).not.toBeInTheDocument()
  })

  it('should render navigation links', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('nav-link-Documents')).toBeInTheDocument()
    expect(screen.getByTestId('nav-link-Settings')).toBeInTheDocument()
  })

  it('should render ExtraInfo', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    const extraInfo = screen.getByTestId('extra-info')
    expect(extraInfo).toHaveAttribute('data-expand', 'true')
    expect(extraInfo).toHaveAttribute('data-doc-count', '10')
  })

  it('should render Effect component', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('effect')).toBeInTheDocument()
  })

  it('should render Dropdown component with expand=true', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('dataset-dropdown')).toHaveAttribute('data-expand', 'true')
  })

  it('should show external tag for external provider', () => {
    mockDataset = createDataset({ provider: 'external' })
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByText('dataset.externalTag')).toBeInTheDocument()
  })

  it('should use fallback icon info when icon_info is missing', () => {
    mockDataset = createDataset({ icon_info: undefined as unknown as DataSet['icon_info'] })
    render(<DatasetSidebarDropdown navigation={navigation} />)
    const icons = screen.getAllByTestId('app-icon')
    const fallbackIcon = icons.find(i => i.getAttribute('data-icon') === '📙')
    expect(fallbackIcon).toBeInTheDocument()
  })

  it('should toggle dropdown open state on trigger click', async () => {
    const user = userEvent.setup()
    render(<DatasetSidebarDropdown navigation={navigation} />)

    const trigger = screen.getByTestId('dropdown-trigger')
    await user.click(trigger)

    expect(screen.getByTestId('dropdown-menu')).toHaveAttribute('data-open', 'true')
  })

  it('should render divider', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(screen.getByTestId('divider')).toBeInTheDocument()
  })

  it('should render medium app icon in content area', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    const icons = screen.getAllByTestId('app-icon')
    const mediumIcon = icons.find(i => i.getAttribute('data-size') === 'medium')
    expect(mediumIcon).toBeInTheDocument()
  })
})
