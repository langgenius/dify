import { trackStepByStepTourEvent } from '../analytics'

const mockTrackEvent = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: mockTrackEvent,
}))

describe('step-by-step tour analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('tracks the unified event with scalar properties only', () => {
    trackStepByStepTourEvent({
      action: 'task_completed',
      completed_task_count: 1,
      home_outcome: 'lesson_app_created',
      permission_variant: 'full',
      task_id: 'home',
      task_total: 4,
    })

    expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', {
      action: 'task_completed',
      completed_task_count: 1,
      home_outcome: 'lesson_app_created',
      permission_variant: 'full',
      task_id: 'home',
      task_total: 4,
    })
  })

  it('omits undefined optional properties', () => {
    trackStepByStepTourEvent({ action: 'tour_enabled' })

    expect(mockTrackEvent).toHaveBeenCalledWith('step_tour', { action: 'tour_enabled' })
  })
})
