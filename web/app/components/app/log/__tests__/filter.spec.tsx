import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement } from 'react'
import type { QueryParam } from '../index'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import Filter from '../filter'

let mockAnnotationsCountLoading = false
let mockAnnotationsCountData: { count: number } | null = { count: 10 }
const scenario = {
  deploymentEdition: 'CLOUD' as DeploymentEdition,
  pending: false,
  planType: 'professional' as CloudPlan,
}

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  if (scenario.pending) {
    void queryClient.query({
      queryKey: consoleQuery.features.get.queryKey(),
      queryFn: () => new Promise(() => {}),
    })
  } else seedFeatures(queryClient, { billing: { subscription: { plan: scenario.planType } } })
  const annotationsCountQueryKey = consoleQuery.apps.byAppId.annotations.count.get.queryKey({
    input: { params: { app_id: 'test-app-id' } },
  })
  if (mockAnnotationsCountLoading) {
    void queryClient.query({
      queryKey: annotationsCountQueryKey,
      queryFn: () => new Promise(() => {}),
    })
  } else if (mockAnnotationsCountData) {
    queryClient.setQueryData(annotationsCountQueryKey, mockAnnotationsCountData)
  } else {
    void queryClient
      .query({
        queryKey: annotationsCountQueryKey,
        queryFn: () => Promise.reject(new Error('annotations count unavailable')),
      })
      .catch(() => {})
  }
  return renderWithConsoleQuery(ui, {
    queryClient,
    systemFeatures: { deployment_edition: scenario.deploymentEdition },
  })
}

const initialQuery: QueryParam = { period: '2', annotation_status: 'all', keyword: '' }
const onChange = vi.fn()
function ControlledFilter({ isChatMode = true }: { isChatMode?: boolean }) {
  const [queryParams, setQueryParams] = useState(initialQuery)
  return (
    <Filter
      appId="test-app-id"
      isChatMode={isChatMode}
      queryParams={queryParams}
      setQueryParams={(value) => {
        onChange(value)
        setQueryParams(value)
      }}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAnnotationsCountLoading = false
  mockAnnotationsCountData = { count: 10 }
  scenario.deploymentEdition = 'CLOUD'
  scenario.pending = false
  scenario.planType = 'professional'
})

it('restricts Cloud sandbox periods to the retained log window', async () => {
  scenario.planType = 'sandbox'
  const user = userEvent.setup()
  render(<ControlledFilter />)
  await user.click(screen.getByRole('combobox', { name: /last7days/ }))
  const options = within(await screen.findByRole('listbox')).getAllByRole('option')
  expect(options.map((item) => item.textContent)).toEqual([
    expect.stringMatching(/filter.period.today/),
    expect.stringMatching(/filter.period.last7days/),
    expect.stringMatching(/filter.period.last30days/),
  ])
})

it('keeps the period list restricted while the plan is pending and follows cache updates', async () => {
  scenario.pending = true
  const user = userEvent.setup()
  const { queryClient } = render(<ControlledFilter />)
  await user.click(screen.getByRole('combobox', { name: /last7days/ }))
  const options = within(await screen.findByRole('listbox'))
  expect(options.getAllByRole('option')).toHaveLength(3)
  act(() => {
    seedFeatures(queryClient, { billing: { subscription: { plan: 'professional' } } })
  })
  await waitFor(() => expect(options.getAllByRole('option')).toHaveLength(9))
  act(() => {
    seedFeatures(queryClient, { billing: { subscription: { plan: 'sandbox' } } })
  })
  await waitFor(() => expect(options.getAllByRole('option')).toHaveLength(3))
})

it.each(['COMMUNITY', 'ENTERPRISE'] as const)('keeps every period in %s', async (edition) => {
  scenario.deploymentEdition = edition
  scenario.planType = 'sandbox'
  const user = userEvent.setup()
  render(<ControlledFilter />)
  await user.click(screen.getByRole('combobox', { name: /last7days/ }))
  expect(within(await screen.findByRole('listbox')).getAllByRole('option')).toHaveLength(9)
})

it.each([
  ['sandbox', '1', /today/],
  ['professional', '9', /allTime/],
] as const)('clears the period to the permitted default for %s', async (plan, period, label) => {
  scenario.planType = plan
  const user = userEvent.setup()
  render(<ControlledFilter />)
  await user.click(screen.getByRole('button', { name: /operation.clear.*last7days/ }))
  expect(onChange).toHaveBeenLastCalledWith({ ...initialQuery, period })
  expect(screen.getByRole('combobox', { name: label })).toBeInTheDocument()
})

it('changes period and annotation through real selectors while preserving the other filters', async () => {
  const user = userEvent.setup()
  render(<ControlledFilter />)
  await user.click(screen.getByRole('combobox', { name: /last7days/ }))
  await user.click(await screen.findByRole('option', { name: /allTime/ }))
  expect(onChange).toHaveBeenLastCalledWith({ ...initialQuery, period: '9' })
  await user.click(screen.getByRole('combobox', { name: /annotation.all/ }))
  await user.click(await screen.findByRole('option', { name: /annotation.annotated/ }))
  expect(onChange).toHaveBeenLastCalledWith({
    ...initialQuery,
    period: '9',
    annotation_status: 'annotated',
  })
  expect(screen.getByRole('combobox', { name: /annotation.annotated.*10/ })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /operation.clear.*annotation.annotated/ }))
  expect(onChange).toHaveBeenLastCalledWith({ ...initialQuery, period: '9' })
})

it('combines text search, sort field and direction, then clears only the keyword', async () => {
  const user = userEvent.setup()
  render(<ControlledFilter />)
  await user.type(screen.getByRole('searchbox'), 'failure')
  await user.click(screen.getByRole('button', { name: /filter.sortBy/ }))
  await user.click(await screen.findByRole('menuitemradio', { name: /header.updatedTime/ }))
  await user.click(screen.getByRole('button', { name: /filter.descending/ }))
  expect(onChange).toHaveBeenLastCalledWith({
    ...initialQuery,
    keyword: 'failure',
    sort_by: '-updated_at',
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))
  expect(onChange).toHaveBeenLastCalledWith({ ...initialQuery, sort_by: '-updated_at' })
})

it('omits chat sorting for completion logs', () => {
  render(<ControlledFilter isChatMode={false} />)
  expect(screen.queryByRole('button', { name: /filter.sortBy/ })).not.toBeInTheDocument()
})

it.each(['loading', 'unavailable'] as const)(
  'does not expose filters while annotations are %s',
  (state) => {
    mockAnnotationsCountLoading = state === 'loading'
    mockAnnotationsCountData = null
    render(<ControlledFilter />)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  },
)
