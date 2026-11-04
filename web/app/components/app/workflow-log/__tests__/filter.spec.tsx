import type { CloudPlan } from '@dify/contracts/api/console/features/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { ReactElement } from 'react'
import type { QueryParam } from '../index'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedFeatures,
} from '@/test/console/query-data'
import Filter from '../filter'

const scenario = {
  deploymentEdition: 'CLOUD' as DeploymentEdition,
  planType: 'professional' as CloudPlan,
}

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  seedFeatures(queryClient, { billing: { subscription: { plan: scenario.planType } } })
  return renderWithConsoleQuery(ui, {
    queryClient,
    systemFeatures: { deployment_edition: scenario.deploymentEdition },
  })
}

const mockTrackEvent = vi.fn()
vi.mock('@/app/components/base/amplitude/utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

const createDefaultQueryParams = (overrides: Partial<QueryParam> = {}): QueryParam => ({
  status: 'all',
  period: '2', // default to last 7 days
  ...overrides,
})

describe('Filter', () => {
  const defaultSetQueryParams = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    scenario.deploymentEdition = 'CLOUD'
    scenario.planType = 'professional'
  })

  describe('Status Filter', () => {
    it('should reset to all when status is cleared', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ status: 'succeeded' })}
          setQueryParams={setQueryParams}
        />,
      )

      const statusTrigger = screen.getByRole('combobox', { name: 'appLog.status.succeeded' })
      const statusChip = statusTrigger.parentElement!
      const clearButton = within(statusChip).getByRole('button', {
        name: /common\.operation\.clear appLog\.status\.succeeded/,
      })

      await user.click(clearButton)

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '2',
      })
    })

    it.each(['running', 'paused', 'scheduled'])(
      'should filter by %s without changing other filters',
      async (status) => {
        const user = userEvent.setup()
        const setQueryParams = vi.fn()
        render(
          <Filter
            queryParams={createDefaultQueryParams({ keyword: 'invoice' })}
            setQueryParams={setQueryParams}
          />,
        )

        await user.click(screen.getByRole('combobox', { name: 'appLog.status.all' }))
        await user.click(await screen.findByRole('option', { name: `appLog.status.${status}` }))

        expect(setQueryParams).toHaveBeenCalledWith({ status, period: '2', keyword: 'invoice' })
        expect(mockTrackEvent).toHaveBeenCalledWith('workflow_log_filter_status_selected', {
          workflow_log_filter_status: status,
        })
      },
    )
  })

  describe('Time Period Filter', () => {
    it('should only show supported periods for Cloud sandbox workspaces', async () => {
      const user = userEvent.setup()
      scenario.deploymentEdition = 'CLOUD'
      scenario.planType = 'sandbox'

      render(
        <Filter queryParams={createDefaultQueryParams()} setQueryParams={defaultSetQueryParams} />,
      )

      await user.click(screen.getByRole('combobox', { name: 'appLog.filter.period.last7days' }))

      const listbox = await screen.findByRole('listbox')
      expect(
        within(listbox)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual([
        'appLog.filter.period.today',
        'appLog.filter.period.last7days',
        'appLog.filter.period.last30days',
      ])
    })

    it('should keep all periods for sandbox workspaces outside Cloud', async () => {
      const user = userEvent.setup()
      scenario.deploymentEdition = 'COMMUNITY'
      scenario.planType = 'sandbox'

      render(
        <Filter queryParams={createDefaultQueryParams()} setQueryParams={defaultSetQueryParams} />,
      )

      await user.click(screen.getByRole('combobox', { name: 'appLog.filter.period.last7days' }))

      const listbox = await screen.findByRole('listbox')
      expect(
        within(listbox).getByRole('option', { name: 'appLog.filter.period.allTime' }),
      ).toBeInTheDocument()
    })

    it('should reset the Cloud sandbox period to today when cleared', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()
      scenario.deploymentEdition = 'CLOUD'
      scenario.planType = 'sandbox'

      render(
        <Filter
          queryParams={createDefaultQueryParams({ period: '3' })}
          setQueryParams={setQueryParams}
        />,
      )

      await user.click(
        screen.getByRole('button', {
          name: /common\.operation\.clear appLog\.filter\.period\.last30days/,
        }),
      )

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '1',
      })
    })

    it('should reset period to allTime when cleared', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ period: '2' })}
          setQueryParams={setQueryParams}
        />,
      )

      const periodTrigger = screen.getByRole('combobox', { name: 'appLog.filter.period.last7days' })
      const periodChip = periodTrigger.parentElement!
      const clearButton = within(periodChip).getByRole('button', {
        name: /common\.operation\.clear appLog\.filter\.period\.last7days/,
      })

      await user.click(clearButton)
      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '9',
      })
    })
  })

  describe('Keyword Search', () => {
    it('should call setQueryParams when typing in search', async () => {
      const user = userEvent.setup()
      const onSetQueryParams = vi.fn()

      const Wrapper = () => {
        const [queryParams, setQueryParams] = useState<QueryParam>(() =>
          createDefaultQueryParams({ keyword: 'existing', status: 'failed', period: '3' }),
        )
        const handleSetQueryParams = (next: QueryParam) => {
          setQueryParams(next)
          onSetQueryParams(next)
        }
        return <Filter queryParams={queryParams} setQueryParams={handleSetQueryParams} />
      }

      render(<Wrapper />)

      const input = screen.getByRole('searchbox', { name: 'common.operation.search' })
      expect(input).toHaveValue('existing')
      await user.clear(input)
      await user.type(input, 'workflow')

      expect(onSetQueryParams).toHaveBeenLastCalledWith({
        keyword: 'workflow',
        status: 'failed',
        period: '3',
      })
    })

    it('should clear keyword when clear button is clicked', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: 'test' })}
          setQueryParams={setQueryParams}
        />,
      )

      const searchInput = screen.getByRole('searchbox', { name: 'common.operation.search' })
      const searchField = searchInput.closest('div')!
      await user.click(within(searchField).getByRole('button', { name: 'common.operation.clear' }))

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '2',
        keyword: '',
      })
    })
  })

  describe('Edge Cases', () => {
    it('should preserve other query params when updating status', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: 'test', period: '3' })}
          setQueryParams={setQueryParams}
        />,
      )

      await user.click(screen.getByText('appLog.status.all'))
      await user.click(await screen.findByText('appLog.status.succeeded'))

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'succeeded',
        period: '3',
        keyword: 'test',
      })
    })

    it('should preserve other query params when updating period', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: 'test', status: 'failed' })}
          setQueryParams={setQueryParams}
        />,
      )

      await user.click(screen.getByText('appLog.filter.period.last7days'))
      await user.click(await screen.findByText('appLog.filter.period.today'))

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'failed',
        period: '1',
        keyword: 'test',
      })
    })
  })
})
