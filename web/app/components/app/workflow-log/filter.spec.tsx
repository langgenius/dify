/**
 * Filter Component Tests
 *
 * Tests the workflow log filter component which provides:
 * - Status filtering (all, succeeded, failed, stopped, partial-succeeded)
 * - Time period selection
 * - Keyword search
 */

import type { QueryParam } from './index'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Filter, { TIME_PERIOD_MAPPING } from './filter'

// ============================================================================
// Mocks
// ============================================================================

const mockTrackEvent = vi.fn()
vi.mock('@/app/components/base/amplitude/utils', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

// ============================================================================
// Test Data Factories
// ============================================================================

const createDefaultQueryParams = (overrides: Partial<QueryParam> = {}): QueryParam => ({
  status: 'all',
  period: '2', // default to last 7 days
  ...overrides,
})

// ============================================================================
// Tests
// ============================================================================

describe('Filter', () => {
  const defaultSetQueryParams = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // --------------------------------------------------------------------------
  // Rendering Tests (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      // Should render status chip, period chip, and search input
      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
    })

    it('should render all filter components', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      // Status chip
      expect(screen.getByText('All')).toBeInTheDocument()
      // Period chip (shows translated key)
      expect(screen.getByText('appLog.filter.period.last7days')).toBeInTheDocument()
      // Search input
      expect(screen.getByPlaceholderText('common.operation.search')).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Status Filter Tests
  // --------------------------------------------------------------------------
  describe('Status Filter', () => {
    it('should display current status value', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({ status: 'succeeded' })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      // Chip should show Success for succeeded status
      expect(screen.getByText('Success')).toBeInTheDocument()
    })

    it('should open status dropdown when clicked', async () => {
      const user = userEvent.setup()

      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      await user.click(screen.getByText('All'))

      // Should show all status options
      await waitFor(() => {
        expect(screen.getByText('Success')).toBeInTheDocument()
        expect(screen.getByText('Fail')).toBeInTheDocument()
        expect(screen.getByText('Stop')).toBeInTheDocument()
        expect(screen.getByText('Partial Success')).toBeInTheDocument()
      })
    })

    it('should call setQueryParams when status is selected', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={setQueryParams}
        />,
      )

      await user.click(screen.getByText('All'))
      await user.click(await screen.findByText('Success'))

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'succeeded',
        period: '2',
      })
    })

    it('should track status selection event', async () => {
      const user = userEvent.setup()

      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      await user.click(screen.getByText('All'))
      await user.click(await screen.findByText('Fail'))

      expect(mockTrackEvent).toHaveBeenCalledWith(
        'workflow_log_filter_status_selected',
        { workflow_log_filter_status: 'failed' },
      )
    })

    it('should reset to all when status is cleared', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      const { container } = render(
        <Filter
          queryParams={createDefaultQueryParams({ status: 'succeeded' })}
          setQueryParams={setQueryParams}
        />,
      )

      // Find the clear icon (div with group/clear class) in the status chip
      const clearIcon = container.querySelector('.group\\/clear')

      expect(clearIcon).toBeInTheDocument()
      await user.click(clearIcon!)

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '2',
      })
    })

    it.each([
      ['all', 'All'],
      ['succeeded', 'Success'],
      ['failed', 'Fail'],
      ['stopped', 'Stop'],
      ['partial-succeeded', 'Partial Success'],
    ])('should display correct label for %s status', (statusValue, expectedLabel) => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({ status: statusValue })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      expect(screen.getByText(expectedLabel)).toBeInTheDocument()
    })
  })

  // --------------------------------------------------------------------------
  // Time Period Filter Tests
  // --------------------------------------------------------------------------
  describe('Time Period Filter', () => {
    it('should display current period value', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({ period: '1' })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      expect(screen.getByText('appLog.filter.period.today')).toBeInTheDocument()
    })

    it('should open period dropdown when clicked', async () => {
      const user = userEvent.setup()

      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      await user.click(screen.getByText('appLog.filter.period.last7days'))

      // Should show all period options
      await waitFor(() => {
        expect(screen.getByText('appLog.filter.period.today')).toBeInTheDocument()
        expect(screen.getByText('appLog.filter.period.last4weeks')).toBeInTheDocument()
        expect(screen.getByText('appLog.filter.period.last3months')).toBeInTheDocument()
        expect(screen.getByText('appLog.filter.period.allTime')).toBeInTheDocument()
      })
    })

    it('should call setQueryParams when period is selected', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={setQueryParams}
        />,
      )

      await user.click(screen.getByText('appLog.filter.period.last7days'))
      await user.click(await screen.findByText('appLog.filter.period.allTime'))

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '9',
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

      // Find the period chip's clear button
      const periodChip = screen.getByText('appLog.filter.period.last7days').closest('div')
      const clearButton = periodChip?.querySelector('button[type="button"]')

      if (clearButton) {
        await user.click(clearButton)
        expect(setQueryParams).toHaveBeenCalledWith({
          status: 'all',
          period: '9',
        })
      }
    })
  })

  // --------------------------------------------------------------------------
  // Keyword Search Tests
  // --------------------------------------------------------------------------
  describe('Keyword Search', () => {
    it('should display current keyword value', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: 'test search' })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      expect(screen.getByDisplayValue('test search')).toBeInTheDocument()
    })

    it('should call setQueryParams when typing in search', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      const Wrapper = () => {
        const [queryParams, updateQueryParams] = useState<QueryParam>(createDefaultQueryParams())
        const handleSetQueryParams = (next: QueryParam) => {
          updateQueryParams(next)
          setQueryParams(next)
        }
        return (
          <Filter
            queryParams={queryParams}
            setQueryParams={handleSetQueryParams}
          />
        )
      }

      render(<Wrapper />)

      const input = screen.getByPlaceholderText('common.operation.search')
      await user.type(input, 'workflow')

      // Should call setQueryParams for each character typed
      expect(setQueryParams).toHaveBeenLastCalledWith(
        expect.objectContaining({ keyword: 'workflow' }),
      )
    })

    it('should clear keyword when clear button is clicked', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      const { container } = render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: 'test' })}
          setQueryParams={setQueryParams}
        />,
      )

      // The Input component renders a clear icon div inside the input wrapper
      // when showClearIcon is true and value exists
      const inputWrapper = container.querySelector('.w-\\[200px\\]')

      // Find the clear icon div (has cursor-pointer class and contains RiCloseCircleFill)
      const clearIconDiv = inputWrapper?.querySelector('div.cursor-pointer')

      expect(clearIconDiv).toBeInTheDocument()
      await user.click(clearIconDiv!)

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '2',
        keyword: '',
      })
    })

    it('should update on direct input change', () => {
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={setQueryParams}
        />,
      )

      const input = screen.getByPlaceholderText('common.operation.search')
      fireEvent.change(input, { target: { value: 'new search' } })

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'all',
        period: '2',
        keyword: 'new search',
      })
    })
  })

  // --------------------------------------------------------------------------
  // TIME_PERIOD_MAPPING Tests
  // --------------------------------------------------------------------------
  describe('TIME_PERIOD_MAPPING', () => {
    it('should have correct mapping for today', () => {
      expect(TIME_PERIOD_MAPPING['1']).toEqual({ value: 0, name: 'today' })
    })

    it('should have correct mapping for last 7 days', () => {
      expect(TIME_PERIOD_MAPPING['2']).toEqual({ value: 7, name: 'last7days' })
    })

    it('should have correct mapping for last 4 weeks', () => {
      expect(TIME_PERIOD_MAPPING['3']).toEqual({ value: 28, name: 'last4weeks' })
    })

    it('should have correct mapping for all time', () => {
      expect(TIME_PERIOD_MAPPING['9']).toEqual({ value: -1, name: 'allTime' })
    })

    it('should have all 9 predefined time periods', () => {
      expect(Object.keys(TIME_PERIOD_MAPPING)).toHaveLength(9)
    })

    it.each([
      ['1', 'today', 0],
      ['2', 'last7days', 7],
      ['3', 'last4weeks', 28],
      ['9', 'allTime', -1],
    ])('TIME_PERIOD_MAPPING[%s] should have name=%s and correct value', (key, name, expectedValue) => {
      const mapping = TIME_PERIOD_MAPPING[key]
      expect(mapping.name).toBe(name)
      if (expectedValue >= 0)
        expect(mapping.value).toBe(expectedValue)
      else
        expect(mapping.value).toBe(-1)
    })
  })

  // --------------------------------------------------------------------------
  // Edge Cases (REQUIRED)
  // --------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle undefined keyword gracefully', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: undefined })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      const input = screen.getByPlaceholderText('common.operation.search')
      expect(input).toHaveValue('')
    })

    it('should handle empty string keyword', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: '' })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      const input = screen.getByPlaceholderText('common.operation.search')
      expect(input).toHaveValue('')
    })

    it('should preserve other query params when updating status', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ keyword: 'test', period: '3' })}
          setQueryParams={setQueryParams}
        />,
      )

      await user.click(screen.getByText('All'))
      await user.click(await screen.findByText('Success'))

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

    it('should preserve other query params when updating keyword', async () => {
      const user = userEvent.setup()
      const setQueryParams = vi.fn()

      render(
        <Filter
          queryParams={createDefaultQueryParams({ status: 'failed', period: '3' })}
          setQueryParams={setQueryParams}
        />,
      )

      const input = screen.getByPlaceholderText('common.operation.search')
      await user.type(input, 'a')

      expect(setQueryParams).toHaveBeenCalledWith({
        status: 'failed',
        period: '3',
        keyword: 'a',
      })
    })
  })

  // --------------------------------------------------------------------------
  // Integration Tests
  // --------------------------------------------------------------------------
  describe('Integration', () => {
    it('should render with all filters visible simultaneously', () => {
      render(
        <Filter
          queryParams={createDefaultQueryParams({
            status: 'succeeded',
            period: '1',
            keyword: 'integration test',
          })}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      expect(screen.getByText('Success')).toBeInTheDocument()
      expect(screen.getByText('appLog.filter.period.today')).toBeInTheDocument()
      expect(screen.getByDisplayValue('integration test')).toBeInTheDocument()
    })

    it('should have proper layout with flex and gap', () => {
      const { container } = render(
        <Filter
          queryParams={createDefaultQueryParams()}
          setQueryParams={defaultSetQueryParams}
        />,
      )

      const filterContainer = container.firstChild as HTMLElement
      expect(filterContainer).toHaveClass('flex')
      expect(filterContainer).toHaveClass('flex-row')
      expect(filterContainer).toHaveClass('gap-2')
    })
  })
})
