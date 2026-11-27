import type { Collaborator } from '@/app/components/workflow/collaboration/components/collaborator-avatar'
import { COLLABORATOR_COLORS } from '@/app/components/workflow/collaboration/utils/user-color'

export const demoUsers = {
  alex: { id: 'alex', name: 'Alex', color: COLLABORATOR_COLORS[0] },
  sam: { id: 'sam', name: 'Sam', color: COLLABORATOR_COLORS[6] },
} satisfies Record<string, Collaborator>

export type DemoUserId = keyof typeof demoUsers
