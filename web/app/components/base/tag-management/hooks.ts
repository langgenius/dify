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
      return invalidateTagConsumers()
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
      return invalidateTagConsumers()
    },
  }))
}

type ApplyTagBindingsInput = {
  currentTagIDs: string[]
  nextTagIDs: string[]
  targetID: string
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
    mutationFn: async ({ currentTagIDs, nextTagIDs, targetID, type }: ApplyTagBindingsInput) => {
      const addTagIDs = nextTagIDs.filter(tagID => !currentTagIDs.includes(tagID))
      const removeTagIDs = currentTagIDs.filter(tagID => !nextTagIDs.includes(tagID))
      const operations: Promise<unknown>[] = []

      if (addTagIDs.length) {
        operations.push(consoleClient.tags.bind({
          body: {
            tag_ids: addTagIDs,
            target_id: targetID,
            type,
          },
        }))
      }

      operations.push(...removeTagIDs.map(tagID => consoleClient.tags.unbind({
        body: {
          tag_id: tagID,
          target_id: targetID,
          type,
        },
      })))

      return Promise.all(operations)
    },
    onSuccess: (_data, variables) => {
      return invalidateTagConsumers(variables.type)
    },
  })
}
