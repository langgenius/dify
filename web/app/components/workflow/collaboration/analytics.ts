import { trackEvent } from '@/app/components/base/amplitude'

export type CollabUpgradeEntryPoint = 'canvas_avatar' | 'canvas_comment_tool' | 'tour_end'

export function trackCollabUpgradePrompt(properties: {
  action: 'shown' | 'upgrade_clicked'
  entry_point: CollabUpgradeEntryPoint
  workspace_id: string
}) {
  trackEvent('collab_upgrade_prompt', properties)
}

export function trackCollabCommentSent(
  properties: {
    workspace_id: string
    app_id: string
    thread_id: string
    comment_id: string
  } & ({ comment_kind: 'thread' } | { comment_kind: 'reply'; is_thread_author: boolean }),
) {
  trackEvent('collab_comment_sent', properties)
}
