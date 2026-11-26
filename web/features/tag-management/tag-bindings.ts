import type { TagType } from '@dify/contracts/api/console/tags/types.gen'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/console'
import { refreshAgentTagCatalogs } from '@/service/console/policies/shared'
import { invalidateTaggedResources } from '@/service/console/policies/tags'

type ApplyTagBindingsInput = {
  currentTagIds: string[]
  nextTagIds: string[]
  targetId: string
  type: TagType
}

export const useApplyTagBindingsMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['tag-bindings', 'apply'],
    meta: { errorToast: false },
    mutationFn: async ({ currentTagIds, nextTagIds, targetId, type }: ApplyTagBindingsInput) => {
      const addTagIds = nextTagIds.filter((tagId) => !currentTagIds.includes(tagId))
      const removeTagIds = currentTagIds.filter((tagId) => !nextTagIds.includes(tagId))
      const operations: Promise<unknown>[] = []

      if (addTagIds.length) {
        operations.push(
          consoleClient.tagBindings.post({
            body: {
              tag_ids: addTagIds,
              target_id: targetId,
              type,
            },
          }),
        )
      }

      if (removeTagIds.length) {
        operations.push(
          consoleClient.tagBindings.remove.post({
            body: {
              tag_ids: removeTagIds,
              target_id: targetId,
              type,
            },
          }),
        )
      }

      // Either request may succeed independently. Refresh only after both writes have settled.
      const results = await Promise.allSettled(operations)
      const failed = results.find((result) => result.status === 'rejected')
      if (failed) throw failed.reason
    },
    onSettled: (_data, _error, { type, targetId }) =>
      Promise.all([
        type === 'agent'
          ? refreshAgentTagCatalogs(consoleQuery, queryClient)
          : queryClient.invalidateQueries({
              queryKey: consoleQuery.tags.get.key({ type: 'query', input: { query: { type } } }),
            }),
        invalidateTaggedResources(consoleQuery, queryClient, type, targetId),
      ]),
  })
}
