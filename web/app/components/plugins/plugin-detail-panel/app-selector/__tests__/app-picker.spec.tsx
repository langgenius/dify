import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AppPicker } from '../app-picker'

const { fetchApps } = vi.hoisted(() => ({ fetchApps: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, { 'apps.get': fetchApps }),
  }
})
vi.mock('@/app/components/base/app-icon', () => ({ default: () => null }))

const app = {
  id: 'app-1',
  name: 'Workflow App',
  mode: 'workflow',
  icon_type: 'emoji',
  icon: 'W',
  icon_background: '#FFFFFF',
  icon_url: null,
}

it('announces loading without an empty result', async () => {
  fetchApps.mockReturnValue(new Promise(() => {}))
  renderWithConsoleQuery(<AppPicker value={null} onSelect={vi.fn()} />)
  expect(await screen.findByText(/common.loading/)).toBeInTheDocument()
  expect(screen.queryByText('common.noData')).not.toBeInTheDocument()
})

it('retries failed searches without announcing an empty result', async () => {
  const user = userEvent.setup()
  fetchApps
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue({ data: [app], page: 1, has_more: false })
  renderWithConsoleQuery(<AppPicker value={null} onSelect={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: 'common.operation.retry' }))
  expect(await screen.findByRole('option', { name: /Workflow App/ })).toBeInTheDocument()
  expect(screen.getByRole('combobox')).toHaveFocus()
  expect(screen.queryByText('common.noData')).not.toBeInTheDocument()
})

it('keeps existing options on a page failure and retries that page outside the listbox', async () => {
  const user = userEvent.setup()
  fetchApps.mockImplementation(({ query }: { query: { page: number } }) => {
    if (query.page === 2) throw new Error('Unavailable')
    return { data: [app], page: 1, has_more: true }
  })
  renderWithConsoleQuery(<AppPicker value={null} onSelect={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: 'workflow.common.loadMore' }))
  const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
  expect(screen.getByRole('option', { name: /Workflow App/ })).toBeInTheDocument()
  expect(screen.getByRole('listbox')).not.toContainElement(retry)
  expect(screen.getByRole('region', { name: 'app.appSelector.label' })).toContainElement(retry)
  fetchApps.mockResolvedValue({
    data: [{ ...app, id: 'app-2', name: 'Next App' }],
    page: 2,
    has_more: false,
  })
  await user.click(retry)
  expect(await screen.findByRole('option', { name: /Next App/ })).toBeInTheDocument()
  await waitFor(() =>
    expect(fetchApps).toHaveBeenLastCalledWith({ query: { page: 2, limit: 20, name: '' } }),
  )
})
