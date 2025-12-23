import type { Mock } from 'vitest'
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Filter, { type QueryParam } from './filter'
import useSWR from 'swr'

vi.mock('swr', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/service/log', () => ({
  fetchAnnotationsCount: vi.fn(),
}))

const mockUseSWR = useSWR as unknown as Mock

describe('Filter', () => {
  const appId = 'app-1'
  const childContent = 'child-content'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render nothing until annotation count is fetched', () => {
    mockUseSWR.mockReturnValue({ data: undefined })

    const { container } = render(
      <Filter
        appId={appId}
        queryParams={{ keyword: '' }}
        setQueryParams={vi.fn()}
      >
        <div>{childContent}</div>
      </Filter>,
    )

    expect(container.firstChild).toBeNull()
    expect(mockUseSWR).toHaveBeenCalledWith(
      { url: `/apps/${appId}/annotations/count` },
      expect.any(Function),
    )
  })

  it('should propagate keyword changes and clearing behavior', () => {
    mockUseSWR.mockReturnValue({ data: { total: 20 } })
    const queryParams: QueryParam = { keyword: 'prefill' }
    const setQueryParams = vi.fn()

    const { container } = render(
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
