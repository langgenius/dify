import type {
  WorkflowCommentAccount,
  WorkflowCommentBasic,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Collaborator } from '../collaboration/components/collaborator-avatar'
import { uniqBy } from 'es-toolkit'
import { getUserColor } from '../collaboration/utils/user-color'

export const toCommentCollaborator = (
  account: Pick<WorkflowCommentAccount, 'id' | 'name' | 'avatar_url'>,
): Collaborator => ({
  id: account.id,
  name: account.name,
  avatarUrl: account.avatar_url,
  color: getUserColor(account.id),
})

/** The comment author first, then the other participants, each once. */
export const getCommentParticipants = (
  comment: Pick<WorkflowCommentBasic, 'created_by_account' | 'participants'>,
): Collaborator[] => {
  const author = comment.created_by_account
  const accounts = author ? [author, ...(comment.participants ?? [])] : (comment.participants ?? [])
  return uniqBy(accounts, (account) => account.id).map(toCommentCollaborator)
}
