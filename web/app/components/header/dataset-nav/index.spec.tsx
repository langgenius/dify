import { act, fireEvent, render, screen, within } from '@testing-library/react'
import {
  useParams,
  useRouter,
  useSelectedLayoutSegment,
} from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import {
  useDatasetDetail,
  useDatasetList,
} from '@/service/knowledge/use-dataset'
import DatasetNav from './index'

vi.mock('next/navigation', () => ({
  useParams: vi.fn(),
  useRouter: vi.fn(),
  useSelectedLayoutSegment: vi.fn(),
}))

vi.mock('@/service/knowledge/use-dataset', () => ({
  useDatasetDetail: vi.fn(),
  useDatasetList: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@remixicon/react', () => ({
  RiBook2Fill: () => <div data-testid="active-icon" />,
  RiBook2Line: () => <div data-testid="inactive-icon" />,
  RiArrowDownSLine: () => <div data-testid="arrow-down-icon" />,
  RiArrowRightSLine: () => <div data-testid="arrow-right-icon" />,
  RiAddLine: () => <div data-testid="add-icon" />,
}))

vi.mock('@/app/components/base/loading', () => ({
  default: () => <div data-testid="loading" />,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: () => <div data-testid="app-icon" />,
}))

vi.mock('@/app/components/app/type-selector', () => ({
  AppTypeIcon: () => <div data-testid="app-type-icon" />,
}))

vi.mock('@/app/components/base/icons/src/vender/line/arrows', () => ({
  ArrowNarrowLeft: () => <div data-testid="arrow-left-icon" />,
}))

vi.mock('@/app/components/base/icons/src/vender/line/files', () => ({
  FileArrow01: () => <div data-testid="file-arrow-icon" />,
  FilePlus01: () => <div data-testid="file-plus-1-icon" />,
  FilePlus02: () => <div data-testid="file-plus-2-icon" />,
}))

describe('DatasetNav', () => {
  const mockPush = vi.fn()
  const mockFetchNextPage = vi.fn()

  const mockDataset = {
    id: 'dataset-1',
    name: 'Test Dataset',
    runtime_mode: 'general',
    icon_info: {
      icon: 'book',
      icon_type: 'image',
      icon_background: '#fff',
      icon_url: '/url',
    },
    provider: 'vendor',
  }

  const mockDatasetList = {
    pages: [
      {
        data: [
          mockDataset,
          {
            id: 'dataset-2',
            name: 'Pipeline Dataset',
            runtime_mode: 'rag_pipeline',
            is_published: false,
            icon_info: { icon: 'pipeline' },
            provider: 'vendor',
          },
          {
            id: 'dataset-3',
            name: 'External Dataset',
            runtime_mode: 'general',
            icon_info: { icon: 'external' },
            provider: 'external',
          },
          {
            id: 'dataset-4',
            name: 'Published Pipeline',
            runtime_mode: 'rag_pipeline',
            is_published: true,
            icon_info: { icon: 'pipeline' },
            provider: 'vendor',
          },
        ],
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>)
    vi.mocked(useParams).mockReturnValue({ datasetId: 'dataset-1' })
    vi.mocked(useSelectedLayoutSegment).mockReturnValue('datasets')
    vi.mocked(useDatasetDetail).mockReturnValue({
      data: mockDataset,
    } as unknown as ReturnType<typeof useDatasetDetail>)
    vi.mocked(useDatasetList).mockReturnValue({
      data: mockDatasetList,
      fetchNextPage: mockFetchNextPage,
      hasNextPage: true,
      isFetchingNextPage: false,
    } as unknown as ReturnType<typeof useDatasetList>)
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as unknown as ReturnType<typeof useAppContext>)
  })

  describe('Rendering', () => {
    it('should render the navigation component', () => {
      render(<DatasetNav />)
      expect(screen.getByText('common.menus.datasets')).toBeInTheDocument()
    })

    it('should render without current dataset correctly', () => {
      vi.mocked(useDatasetDetail).mockReturnValue({
        data: undefined,
      } as unknown as ReturnType<typeof useDatasetDetail>)
      render(<DatasetNav />)
      expect(screen.getByText('common.menus.datasets')).toBeInTheDocument()
    })
  })

  describe('Navigation Items logic', () => {
    it('should generate correct links for different dataset types', () => {
      render(<DatasetNav />)

      const selector = screen.getByRole('button', { name: /Test Dataset/i })
      fireEvent.click(selector)

      const menu = screen.getByRole('menu')
      expect(within(menu).getByText('Test Dataset')).toBeInTheDocument()
      expect(within(menu).getByText('Pipeline Dataset')).toBeInTheDocument()
      expect(within(menu).getByText('External Dataset')).toBeInTheDocument()
    })

    it('should navigate to correct link when an item is clicked', () => {
      render(<DatasetNav />)
      const selector = screen.getByRole('button', { name: /Test Dataset/i })
      fireEvent.click(selector)

      const menu = screen.getByRole('menu')
      const pipelineItem = within(menu).getByText('Pipeline Dataset')
      fireEvent.click(pipelineItem)

      // dataset-2 is rag_pipeline and not published -> /datasets/dataset-2/pipeline
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-2/pipeline')

      fireEvent.click(selector)
      const menu2 = screen.getByRole('menu')
      const externalItem = within(menu2).getByText('External Dataset')
      fireEvent.click(externalItem)
      // dataset-3 is provider external -> /datasets/dataset-3/hitTesting
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-3/hitTesting')

      fireEvent.click(selector)
      const menu3 = screen.getByRole('menu')
      const publishedItem = within(menu3).getByText('Published Pipeline')
      fireEvent.click(publishedItem)
      // dataset-4 is rag_pipeline and published -> /datasets/dataset-4/documents
      expect(mockPush).toHaveBeenCalledWith('/datasets/dataset-4/documents')
    })
  })

  describe('User Interactions', () => {
    it('should call router.push with correct path when creating a general dataset', () => {
      render(<DatasetNav />)

      const selector = screen.getByRole('button', { name: /Test Dataset/i })
      fireEvent.click(selector)

      const menu = screen.getByRole('menu')
      const createBtn = within(menu).getByText('common.menus.newDataset')
      fireEvent.click(createBtn)

      expect(mockPush).toHaveBeenCalledWith('/datasets/create')
    })

    it('should call router.push with correct path when creating a pipeline dataset', () => {
      vi.mocked(useDatasetDetail).mockReturnValue({
        data: { ...mockDataset, runtime_mode: 'rag_pipeline' },
      } as unknown as ReturnType<typeof useDatasetDetail>)

      render(<DatasetNav />)
      const selector = screen.getByRole('button', { name: /Test Dataset/i })
      fireEvent.click(selector)

      const menu = screen.getByRole('menu')
      const createBtn = within(menu).getByText('common.menus.newDataset')
      fireEvent.click(createBtn)

      expect(mockPush).toHaveBeenCalledWith('/datasets/create-from-pipeline')
    })

    it('should trigger fetchNextPage when loading more', () => {
      vi.useFakeTimers()
      render(<DatasetNav />)
      const selector = screen.getByRole('button', { name: /Test Dataset/i })
      fireEvent.click(selector)

      const menu = screen.getByRole('menu')
      const scrollContainer = menu.querySelector('.overflow-auto')
      if (scrollContainer) {
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000 })
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 500 })
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 500 })

        fireEvent.scroll(scrollContainer)
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(mockFetchNextPage).toHaveBeenCalled()
      }
      vi.useRealTimers()
    })

    it('should not trigger fetchNextPage if hasNextPage is false', () => {
      vi.useFakeTimers()
      vi.mocked(useDatasetList).mockReturnValue({
        data: mockDatasetList,
        fetchNextPage: mockFetchNextPage,
        hasNextPage: false,
        isFetchingNextPage: false,
      } as unknown as ReturnType<typeof useDatasetList>)

      render(<DatasetNav />)
      const selector = screen.getByRole('button', { name: /Test Dataset/i })
      fireEvent.click(selector)

      const menu = screen.getByRole('menu')
      const scrollContainer = menu.querySelector('.overflow-auto')
      if (scrollContainer) {
        Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000 })
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 500 })
        Object.defineProperty(scrollContainer, 'scrollTop', { value: 500 })

        fireEvent.scroll(scrollContainer)
        act(() => {
          vi.advanceTimersByTime(100)
        })
        expect(mockFetchNextPage).not.toHaveBeenCalled()
      }
      vi.useRealTimers()
    })
  })
})
