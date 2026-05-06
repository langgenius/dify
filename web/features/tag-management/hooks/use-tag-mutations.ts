import type { TagType } from '@/contract/console/tags'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

const getTagsListQueryOptions = (tagType: TagType) => consoleQuery.tags.list.queryOptions({
  input: {
    query: {
      type: tagType,
    },
  },
})

export const useCreateTagMutation = () => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.tags.create.mutationOptions({
    onSuccess: (tag) => {
      queryClient.setQueryData(
        getTagsListQueryOptions(tag.type).queryKey,
        oldTags => oldTags ? [tag, ...oldTags] : oldTags,
      )
    },
  }))
}

export const useUpdateTagMutation = (tagType: TagType) => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.tags.update.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(
        getTagsListQueryOptions(tagType).queryKey,
        oldTags => oldTags?.map(tag => tag.id === variables.params.tagId
          ? {
              ...tag,
              name: variables.body.name,
            }
          : tag),
      )
    },
  }))
}

export const useDeleteTagMutation = (tagType: TagType) => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.tags.delete.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(
        getTagsListQueryOptions(tagType).queryKey,
        oldTags => oldTags?.filter(tag => tag.id !== variables.params.tagId),
      )
    },
  }))
}

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
        queryKey: getTagsListQueryOptions(variables.type).queryKey,
      })
    },
  })
}
