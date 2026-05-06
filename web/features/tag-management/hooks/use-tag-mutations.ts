import type { Tag, TagType } from '@/contract/console/tags'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'
import { datasetListQueryKey } from '@/service/knowledge/use-dataset'

export const useCreateTagMutation = () => {
  const queryClient = useQueryClient()

  return useMutation(consoleQuery.tags.create.mutationOptions({
    onSuccess: (tag) => {
      queryClient.setQueryData<Tag[]>(
        consoleQuery.tags.list.queryKey({
          input: {
            query: {
              type: tag.type,
            },
          },
        }),
        oldTags => oldTags ? [tag, ...oldTags] : oldTags,
      )
    },
  }))
}

export const useUpdateTagMutation = () => {
  const queryClient = useQueryClient()
  const invalidateTagConsumers = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: consoleQuery.apps.list.key() }),
    queryClient.invalidateQueries({ queryKey: datasetListQueryKey }),
  ])

  return useMutation(consoleQuery.tags.update.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.setQueriesData<Tag[]>(
        {
          queryKey: consoleQuery.tags.list.key(),
        },
        oldTags => oldTags?.map(tag => tag.id === variables.params.tagId
          ? {
              ...tag,
              name: variables.body.name,
            }
          : tag),
      )
      void invalidateTagConsumers()
    },
  }))
}

export const useDeleteTagMutation = () => {
  const queryClient = useQueryClient()
  const invalidateTagConsumers = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: consoleQuery.apps.list.key() }),
    queryClient.invalidateQueries({ queryKey: datasetListQueryKey }),
  ])

  return useMutation(consoleQuery.tags.delete.mutationOptions({
    onSuccess: (_data, variables) => {
      queryClient.setQueriesData<Tag[]>(
        {
          queryKey: consoleQuery.tags.list.key(),
        },
        oldTags => oldTags?.filter(tag => tag.id !== variables.params.tagId),
      )
      void invalidateTagConsumers()
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
  const invalidateTagConsumers = (type: TagType) => {
    const targetQueryKey = type === 'app'
      ? consoleQuery.apps.list.key()
      : datasetListQueryKey

    return Promise.all([
      queryClient.invalidateQueries({ queryKey: consoleQuery.tags.list.key() }),
      queryClient.invalidateQueries({ queryKey: targetQueryKey }),
    ])
  }

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

      operations.push(...removeTagIds.map(tagId => consoleClient.tags.unbind({
        body: {
          tag_id: tagId,
          target_id: targetId,
          type,
        },
      })))

      return Promise.all(operations)
    },
    onSettled: (_data, _error, variables) => {
      void invalidateTagConsumers(variables.type)
    },
  })
}
