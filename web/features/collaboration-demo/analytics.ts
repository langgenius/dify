import { trackEvent } from '@/app/components/base/amplitude'

type TourStep = 'members' | 'comment' | 'playback'

export type TourOutcome = { action: 'tour_completed' } | { action: 'tour_skipped'; step: TourStep }

export function trackCollabTour(
  event: { action: 'tour_shown' } | TourOutcome,
  workspace: { id: string; plan: string | null },
) {
  trackEvent('collab_tour', {
    ...event,
    workspace_id: workspace.id,
    workspace_plan: workspace.plan ?? undefined,
  })
}
