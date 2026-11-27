import type {
  WorkflowCommentAccount,
  WorkflowCommentBasic,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Collaborator } from '../collaboration/components/collaborator-avatar'
import { uniqBy } from 'es-toolkit'

/** A comment account as a collaborator; `fallbackName` stands in for a missing account or name. */
export const toCommentCollaborator = (
  account: Pick<WorkflowCommentAccount, 'id' | 'name' | 'avatar_url'> | null | undefined,
  fallbackName = '',
): Collaborator => ({
  id: account?.id ?? '',
  name: account?.name || fallbackName,
  avatarUrl: account?.avatar_url ?? null,
})

/** The comment author first, then the other participants, each once. */
export const getCommentParticipants = (
  comment: Pick<WorkflowCommentBasic, 'created_by_account' | 'participants'>,
): Collaborator[] => {
  const author = comment.created_by_account
  const accounts = author ? [author, ...(comment.participants ?? [])] : (comment.participants ?? [])
  return uniqBy(accounts, (account) => account.id).map((account) => toCommentCollaborator(account))
}
