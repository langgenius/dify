import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { skipToken } from '@tanstack/react-query'
import { atom } from 'jotai'
import { atomWithQuery } from 'jotai-tanstack-query'
import { collaborationEnabledAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { editorAppIdAtom } from '../editor-resource/state'

const EMPTY_COMMENTS: WorkflowCommentBasic[] = []
const commentsQueryAtom = atomWithQuery((get) => {
  const appId = get(editorAppIdAtom)
  return consoleQuery.apps.byAppId.workflow.comments.get.queryOptions({
    input: appId ? { params: { app_id: appId } } : skipToken,
    enabled: !!appId && get(collaborationEnabledAtom),
    select: (response) => response.data,
  })
})

export const commentsAtom = atom((get) => get(commentsQueryAtom).data ?? EMPTY_COMMENTS)
export const commentsLoadingAtom = atom((get) => get(commentsQueryAtom).isLoading)

export function createCommentDetailAtoms(commentId: string | null | undefined) {
  const queryAtom = atomWithQuery((get) => {
    const appId = get(editorAppIdAtom)
    return consoleQuery.apps.byAppId.workflow.comments.byCommentId.get.queryOptions({
      input: appId && commentId ? { params: { app_id: appId, comment_id: commentId } } : skipToken,
      enabled: !!appId && !!commentId && get(collaborationEnabledAtom),
    })
  })
  return {
    data: atom((get) => get(queryAtom).data),
    loading: atom((get) => get(queryAtom).isLoading),
  }
}
