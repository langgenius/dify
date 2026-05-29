import { act, render, screen } from '@testing-library/react'
import GenerationPhases from '../generation-phases'

describe('GenerationPhases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // The first frame the user sees during generation must be the "planning"
  // phase — never an empty container or a different phase — so the perceived
  // latency starts dropping immediately.
  it('should start on the planning phase', () => {
    render(<GenerationPhases />)
    expect(screen.getByText(/phases\.planning/i)).toBeInTheDocument()
  })

  // After the planner timer elapses we move to "building". The component
  // doesn't reset to "planning" if the parent stays mounted — the timer
  // chain only steps forward.
  it('should advance to the building phase after the planning timer', () => {
    render(<GenerationPhases />)

    act(() => {
      vi.advanceTimersByTime(3500)
    })

    expect(screen.getByText(/phases\.building/i)).toBeInTheDocument()
    expect(screen.queryByText(/phases\.planning/i)).not.toBeInTheDocument()
  })

  // The validating phase is the last in the schedule; once we get there we
  // stay there indefinitely so a slow LLM doesn't make the indicator loop
  // backwards and confuse the user.
  it('should land on validating and not loop back to planning even after long delays', () => {
    render(<GenerationPhases />)

    // Advance through phases in two steps — React schedules the next
    // ``setTimeout`` only after the prior effect re-runs with the new
    // ``phaseIndex``, so a single combined advance leaves us mid-phase.
    act(() => {
      vi.advanceTimersByTime(3500)
    })
    act(() => {
      vi.advanceTimersByTime(12000)
    })
    expect(screen.getByText(/phases\.validating/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60000)
    })
    // Still validating — no reset, no loop.
    expect(screen.getByText(/phases\.validating/i)).toBeInTheDocument()
    expect(screen.queryByText(/phases\.planning/i)).not.toBeInTheDocument()
  })

  // Unmount cleanup matters because the modal is destroyed when the user
  // closes it mid-generation; lingering timers would keep firing setState on
  // an unmounted tree.
  it('should not leak a timer when unmounted before the next phase fires', () => {
    const { unmount } = render(<GenerationPhases />)
    // Sanity: pending timer should exist.
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
