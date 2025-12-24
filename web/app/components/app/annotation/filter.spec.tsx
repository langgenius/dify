import type { Mock } from 'vitest'
import type { QueryParam } from './filter'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import * as useLogModule from '@/service/use-log'
import Filter from './filter'

vi.mock('@/service/use-log')

const mockUseAnnotationsCount = useLogModule.useAnnotationsCount as Mock

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )
}

describe('Filter', () => {
  const appId = 'app-1'
  const childContent = 'child-content'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing until annotation count is fetched', () => {
    mockUseAnnotationsCount.mockReturnValue({ data: undefined, isLoading: true })

    const { container } = renderWithQueryClient(
      <Filter
        appId={appId}
        queryParams={{ keyword: '' }}
        setQueryParams={vi.fn()}
      >
        <div>{childContent}</div>
      </Filter>,
    )

    expect(container.firstChild).toBeNull()
    expect(mockUseAnnotationsCount).toHaveBeenCalledWith(appId)
  })

  it('should propagate keyword changes and clearing behavior', () => {
    mockUseAnnotationsCount.mockReturnValue({ data: { count: 20 }, isLoading: false })
    const queryParams: QueryParam = { keyword: 'prefill' }
    const setQueryParams = vi.fn()

    const { container } = renderWithQueryClient(
      <Filter
        appId={appId}
        queryParams={queryParams}
        setQueryParams={setQueryParams}
      >
        <div>{childContent}</div>
      </Filter>,
    )

    const input = screen.getByPlaceholderText('common.operation.search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'updated' } })
    expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: 'updated' })

    const clearButton = input.parentElement?.querySelector('div.cursor-pointer') as HTMLElement
    fireEvent.click(clearButton)
    expect(setQueryParams).toHaveBeenCalledWith({ ...queryParams, keyword: '' })

    expect(container).toHaveTextContent(childContent)
  })
})
