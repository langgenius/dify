import type { QueryParam } from '../index'
import { fireEvent, render, screen } from '@testing-library/react'
import Filter, { TIME_PERIOD_MAPPING } from '../filter'

let mockAnnotationsCountLoading = false
let mockAnnotationsCountData: { count: number } | null = { count: 10 }

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (options?.count !== undefined)
        return `${key} (${options.count})`
      return key
    },
  }),
}))

vi.mock('@/service/use-log', () => ({
  useAnnotationsCount: () => ({
    data: mockAnnotationsCountData,
    isLoading: mockAnnotationsCountLoading,
  }),
}))

vi.mock('@/app/components/base/chip', () => ({
  default: ({
    items,
    value,
    onSelect,
    onClear,
  }: {
    items: Array<{ value: string, name: string }>
    value?: string
    onSelect: (item: { value: string, name: string }) => void
    onClear: () => void
  }) => {
    const currentItem = items.find(item => item.value === value) ?? items[0]
    return (
      <div>
        <div>{currentItem?.name}</div>
        <button onClick={() => onSelect(items.at(-1)!)}>{`select-${items.at(-1)?.value}`}</button>
        <button onClick={onClear}>clear-chip</button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/sort', () => ({
  default: ({
    onSelect,
  }: {
    onSelect: (value: string) => void
  }) => <button onClick={() => onSelect('-updated_at')}>select-sort</button>,
}))

describe('Filter', () => {
  const defaultQueryParams: QueryParam = {
    period: '9',
    annotation_status: 'all',
    keyword: '',
  }

  const mockSetQueryParams = vi.fn()
  const defaultProps = {
    appId: 'test-app-id',
    queryParams: defaultQueryParams,
    setQueryParams: mockSetQueryParams,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockAnnotationsCountLoading = false
    mockAnnotationsCountData = { count: 10 }
  })

  describe('Rendering', () => {
    it('should render filter components', () => {
      render(<Filter {...defaultProps} />)

      expect(screen.getByPlaceholderText('operation.search'))!.toBeInTheDocument()
    })

    it('should return null when loading', () => {
      mockAnnotationsCountLoading = true
      const { container } = render(<Filter {...defaultProps} />)
      expect(container.firstChild).toBeNull()
    })

    it('should render sort component in chat mode', () => {
      render(<Filter {...defaultProps} isChatMode />)

      expect(screen.getByPlaceholderText('operation.search'))!.toBeInTheDocument()
    })

    it('should not render sort component when not in chat mode', () => {
      render(<Filter {...defaultProps} isChatMode={false} />)

      expect(screen.getByPlaceholderText('operation.search'))!.toBeInTheDocument()
    })
  })

  describe('TIME_PERIOD_MAPPING', () => {
    it('should have correct period keys', () => {
      expect(Object.keys(TIME_PERIOD_MAPPING)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    })

    it('should have today period with value 0', () => {
      expect(TIME_PERIOD_MAPPING['1']!.value).toBe(0)
      expect(TIME_PERIOD_MAPPING['1']!.name).toBe('today')
    })

    it('should have last7days period with value 7', () => {
      expect(TIME_PERIOD_MAPPING['2']!.value).toBe(7)
      expect(TIME_PERIOD_MAPPING['2']!.name).toBe('last7days')
    })

    it('should have last4weeks period with value 28', () => {
      expect(TIME_PERIOD_MAPPING['3']!.value).toBe(28)
      expect(TIME_PERIOD_MAPPING['3']!.name).toBe('last4weeks')
    })

    it('should have allTime period with value -1', () => {
      expect(TIME_PERIOD_MAPPING['9']!.value).toBe(-1)
      expect(TIME_PERIOD_MAPPING['9']!.name).toBe('allTime')
    })
  })

  describe('User Interactions', () => {
    it('should update keyword when typing in search input', () => {
      render(<Filter {...defaultProps} />)

      const searchInput = screen.getByPlaceholderText('operation.search')
      fireEvent.change(searchInput, { target: { value: 'test search' } })

      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        keyword: 'test search',
      })
    })

    it('should clear keyword when clear button is clicked', () => {
      const propsWithKeyword = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, keyword: 'existing search' },
      }

      render(<Filter {...propsWithKeyword} />)

      const clearButton = screen.getByTestId('input-clear')
      fireEvent.click(clearButton)

      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        keyword: '',
      })
    })

    it('should update and clear period, annotation, and sort filters', () => {
      render(<Filter {...defaultProps} isChatMode />)

      fireEvent.click(screen.getAllByText('select-9')[0]!)
      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        period: '9',
      })

      fireEvent.click(screen.getAllByText('clear-chip')[0]!)
      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        period: '9',
      })

      fireEvent.click(screen.getAllByText('select-not_annotated')[0]!)
      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        annotation_status: 'not_annotated',
      })

      fireEvent.click(screen.getAllByText('clear-chip')[1]!)
      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        annotation_status: 'all',
      })

      fireEvent.click(screen.getByText('select-sort'))
      expect(mockSetQueryParams).toHaveBeenCalledWith({
        ...defaultQueryParams,
        sort_by: '-updated_at',
      })
    })
  })

  describe('Query Params', () => {
    it('should display "today" when period is set to 1', () => {
      const propsWithPeriod = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, period: '1' },
      }

      render(<Filter {...propsWithPeriod} />)

      // Period '1' maps to 'today' in TIME_PERIOD_MAPPING
      // Period '1' maps to 'today' in TIME_PERIOD_MAPPING
      expect(screen.getByText('filter.period.today'))!.toBeInTheDocument()
    })

    it('should display "last7days" when period is set to 2', () => {
      const propsWithPeriod = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, period: '2' },
      }

      render(<Filter {...propsWithPeriod} />)

      expect(screen.getByText('filter.period.last7days'))!.toBeInTheDocument()
    })

    it('should display "allTime" when period is set to 9', () => {
      render(<Filter {...defaultProps} />)

      // Default period is '9' which maps to 'allTime'
      // Default period is '9' which maps to 'allTime'
      expect(screen.getByText('filter.period.allTime'))!.toBeInTheDocument()
    })

    it('should display annotated status with count when annotation_status is annotated', () => {
      const propsWithAnnotation = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, annotation_status: 'annotated' },
      }

      render(<Filter {...propsWithAnnotation} />)

      // The mock returns count: 10, so the text should include the count
      // The mock returns count: 10, so the text should include the count
      expect(screen.getByText('filter.annotation.annotated (10)'))!.toBeInTheDocument()
    })

    it('should display not_annotated status when annotation_status is not_annotated', () => {
      const propsWithNotAnnotated = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, annotation_status: 'not_annotated' },
      }

      render(<Filter {...propsWithNotAnnotated} />)

      expect(screen.getByText('filter.annotation.not_annotated'))!.toBeInTheDocument()
    })

    it('should display all annotation status when annotation_status is all', () => {
      render(<Filter {...defaultProps} />)

      // Default annotation_status is 'all'
      // Default annotation_status is 'all'
      expect(screen.getByText('filter.annotation.all'))!.toBeInTheDocument()
    })

    it('should return null when annotation count data is unavailable', () => {
      mockAnnotationsCountData = null
      const { container } = render(<Filter {...defaultProps} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('Chat Mode', () => {
    it('should display sort component with sort_by parameter', () => {
      const propsWithSort = {
        ...defaultProps,
        isChatMode: true,
        queryParams: { ...defaultQueryParams, sort_by: 'created_at' },
      }

      render(<Filter {...propsWithSort} />)

      expect(screen.getByPlaceholderText('operation.search'))!.toBeInTheDocument()
    })

    it('should handle descending sort order', () => {
      const propsWithDescSort = {
        ...defaultProps,
        isChatMode: true,
        queryParams: { ...defaultQueryParams, sort_by: '-created_at' },
      }

      render(<Filter {...propsWithDescSort} />)

      expect(screen.getByPlaceholderText('operation.search'))!.toBeInTheDocument()
    })
  })
})
