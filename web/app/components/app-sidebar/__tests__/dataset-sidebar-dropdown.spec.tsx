import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import DatasetSidebarDropdown from '../components/dataset-sidebar-dropdown'

vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: () => 'documents',
}))

vi.mock('next/link', () => ({
  default: ({ children, href, className }: { children: React.ReactNode, href: string, className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: vi.fn(),
}))

vi.mock('@/hooks/use-knowledge', () => ({
  useKnowledge: () => ({
    formatIndexingTechniqueAndMethod: (technique: string, method?: string) => `${technique}/${method}`,
  }),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetRelatedApps: () => ({ data: [] }),
}))

vi.mock('../dataset-info/dropdown', () => ({
  default: ({ expand }: { expand?: boolean }) => (
    <div data-testid="dropdown" data-expand={expand} />
  ),
}))

const MockIcon = ({ className }: { className?: string }) => <svg className={className} />

const navigation = [
  { name: 'Documents', href: '/datasets/ds-1/documents', icon: MockIcon, selectedIcon: MockIcon },
  { name: 'Settings', href: '/datasets/ds-1/settings', icon: MockIcon, selectedIcon: MockIcon },
]

const mockDataset = {
  id: 'ds-1',
  name: 'Test Dataset',
  description: 'A test dataset',
  icon_info: { icon: '📚', icon_type: 'emoji' as const, icon_background: '#EEF4FF', icon_url: '' },
  provider: 'internal',
  doc_form: 'text_model',
  indexing_technique: 'high_quality',
  document_count: 42,
  retrieval_model_dict: { search_method: 'semantic_search' },
}

function openDropdown() {
  const trigger = document.querySelector('[class*="cursor-pointer"]')
  if (trigger)
    fireEvent.click(trigger)
}

describe('DatasetSidebarDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDatasetDetailContextWithSelector).mockReturnValue(mockDataset as never)
  })

  it('should render trigger element', () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    expect(document.querySelector('[class*="cursor-pointer"]')).toBeInTheDocument()
  })

  it('should show dataset name after opening', async () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('Test Dataset')).toBeInTheDocument())
  })

  it('should show description after opening', async () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('A test dataset')).toBeInTheDocument())
  })

  it('should show navigation items after opening', async () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument()
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
  })

  it('should show indexing info for internal provider', async () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('high_quality/semantic_search')).toBeInTheDocument())
  })

  it('should show Dropdown component', async () => {
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByTestId('dropdown')).toBeInTheDocument())
  })

  it('should show external tag for external provider', async () => {
    vi.mocked(useDatasetDetailContextWithSelector).mockReturnValue({
      ...mockDataset,
      provider: 'external',
    } as never)
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('dataset.externalTag')).toBeInTheDocument())
  })

  it('should hide description when empty', async () => {
    vi.mocked(useDatasetDetailContextWithSelector).mockReturnValue({
      ...mockDataset,
      description: '',
    } as never)
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('Test Dataset')).toBeInTheDocument())
    expect(screen.queryByText('A test dataset')).not.toBeInTheDocument()
  })

  it('should use fallback icon when icon_info is missing', async () => {
    vi.mocked(useDatasetDetailContextWithSelector).mockReturnValue({
      ...mockDataset,
      icon_info: null,
    } as never)
    render(<DatasetSidebarDropdown navigation={navigation} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => expect(screen.getByText('Test Dataset')).toBeInTheDocument())
  })

  it('should render disabled nav items', async () => {
    const nav = [
      { name: 'Docs', href: '/ds/ds-1/documents', icon: MockIcon, selectedIcon: MockIcon, disabled: true },
    ]
    render(<DatasetSidebarDropdown navigation={nav} />)
    act(() => {
      openDropdown()
    })
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Docs/i })
      expect(btn).toBeDisabled()
    })
  })
})
