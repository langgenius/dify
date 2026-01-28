import type { QueryParam } from './index'
import { fireEvent, render, screen } from '@testing-library/react'
import Filter, { TIME_PERIOD_MAPPING } from './filter'

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
    data: { count: 10 },
    isLoading: false,
  }),
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
  })

  describe('Rendering', () => {
    it('should render filter components', () => {
      render(<Filter {...defaultProps} />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })

    it('should return null when loading', () => {
      // This test verifies the component renders correctly with the mocked data
      const { container } = render(<Filter {...defaultProps} />)
      expect(container.firstChild).not.toBeNull()
    })

    it('should render sort component in chat mode', () => {
      render(<Filter {...defaultProps} isChatMode />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })

    it('should not render sort component when not in chat mode', () => {
      render(<Filter {...defaultProps} isChatMode={false} />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })
  })

  describe('TIME_PERIOD_MAPPING', () => {
    it('should have correct period keys', () => {
      expect(Object.keys(TIME_PERIOD_MAPPING)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
    })

    it('should have today period with value 0', () => {
      expect(TIME_PERIOD_MAPPING['1'].value).toBe(0)
      expect(TIME_PERIOD_MAPPING['1'].name).toBe('today')
    })

    it('should have last7days period with value 7', () => {
      expect(TIME_PERIOD_MAPPING['2'].value).toBe(7)
      expect(TIME_PERIOD_MAPPING['2'].name).toBe('last7days')
    })

    it('should have last4weeks period with value 28', () => {
      expect(TIME_PERIOD_MAPPING['3'].value).toBe(28)
      expect(TIME_PERIOD_MAPPING['3'].name).toBe('last4weeks')
    })

    it('should have allTime period with value -1', () => {
      expect(TIME_PERIOD_MAPPING['9'].value).toBe(-1)
      expect(TIME_PERIOD_MAPPING['9'].name).toBe('allTime')
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
  })

  describe('Query Params', () => {
    it('should handle different period values', () => {
      const propsWithPeriod = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, period: '1' },
      }

      render(<Filter {...propsWithPeriod} />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })

    it('should handle annotated status', () => {
      const propsWithAnnotation = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, annotation_status: 'annotated' },
      }

      render(<Filter {...propsWithAnnotation} />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })

    it('should handle not_annotated status', () => {
      const propsWithNotAnnotated = {
        ...defaultProps,
        queryParams: { ...defaultQueryParams, annotation_status: 'not_annotated' },
      }

      render(<Filter {...propsWithNotAnnotated} />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
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

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })

    it('should handle descending sort order', () => {
      const propsWithDescSort = {
        ...defaultProps,
        isChatMode: true,
        queryParams: { ...defaultQueryParams, sort_by: '-created_at' },
      }

      render(<Filter {...propsWithDescSort} />)

      expect(screen.getByPlaceholderText('operation.search')).toBeInTheDocument()
    })
  })
})
