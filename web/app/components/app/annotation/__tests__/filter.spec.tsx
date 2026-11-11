import type { QueryParam } from '../filter'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import Filter from '../filter'

const mockUseQuery = vi.fn()
const onChange = vi.fn()
function ControlledFilter() {
  const [query, setQuery] = useState<QueryParam>({ keyword: 'initial' })
  return (
    <Filter
      appId="app-1"
      queryParams={query}
      setQueryParams={(next) => {
        setQuery(next)
        onChange(next)
      }}
    >
      <button type="button">Add annotation</button>
    </Filter>
  )
}

beforeEach(() => vi.resetAllMocks())

it('withholds filters while annotation count is loading', () => {
  mockUseQuery.mockReturnValue(new Promise(() => {}))
  renderWithConsoleQuery(<ControlledFilter />)
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add annotation' })).not.toBeInTheDocument()
})

it.each([0, 20])('searches and clears annotations after count %i loads', async (count) => {
  const user = userEvent.setup()
  mockUseQuery.mockResolvedValue({ count })
  renderWithConsoleQuery(<ControlledFilter />)
  const input = await screen.findByRole('searchbox', { name: 'common.operation.search' })
  expect(input).toHaveValue('initial')
  expect(mockUseQuery).toHaveBeenCalledWith({ params: { app_id: 'app-1' } })
  expect(screen.getByRole('button', { name: 'Add annotation' })).toBeInTheDocument()
  await user.clear(input)
  await user.type(input, 'updated')
  expect(onChange).toHaveBeenLastCalledWith({ keyword: 'updated' })
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(onChange).toHaveBeenLastCalledWith({ keyword: '' })
  expect(input).toHaveValue('')
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.annotations.count.get': (input) => mockUseQuery(input),
    }),
  }
})
