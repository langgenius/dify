import type { TagType } from '@/contract/console/tags'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

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
    mutationFn: async ({ currentTagIds, nextTagIds, targetId, type }: ApplyTagBindingsInput) => {
      const addTagIds = nextTagIds.filter(tagId => !currentTagIds.includes(tagId))
      const removeTagIds = currentTagIds.filter(tagId => !nextTagIds.includes(tagId))
      const operations: Promise<unknown>[] = []

      if (addTagIds.length) {
        operations.push(consoleClient.tags.bind({
          body: {
            tag_ids: addTagIds,
            target_id: targetId,
            type,
          },
        }))
      }

      if (removeTagIds.length) {
        operations.push(consoleClient.tags.unbind({
          body: {
            tag_ids: removeTagIds,
            target_id: targetId,
            type,
          },
        }))
      }

      return Promise.all(operations)
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.tags.list.key({
          type: 'query',
          input: {
            query: {
              type: variables.type,
            },
          },
        }),
      })
    },
  })
}
