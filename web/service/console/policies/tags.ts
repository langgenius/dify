import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsolePolicies, ConsoleQuery } from './types'
import { invalidateQueryKeys } from './shared'

// A renamed or deleted tag changes the tag chips on every resource that carries it.
const taggedResources = ['apps', 'agent', 'datasets', 'knowledgeFs', 'workspaces.current.skills']

export function tagPolicies(consoleQuery: ConsoleQuery): ConsolePolicies['tags'] {
  return {
    post: {
      mutationOptions: {
        // Skills read their tag catalog from their own endpoint.
        meta: { alsoInvalidate: ['workspaces.current.skills'] },
        onSuccess: async (tag, { body: { type } }, _result, { client, meta }) => {
          const queryKey = consoleQuery.tags.get.queryKey({ input: { query: { type } } })
          if (type === 'agent') await client.cancelQueries({ queryKey })

          client.setQueryData(
            queryKey,
            (oldTags: Tag[] | undefined) =>
              oldTags && [tag, ...oldTags.filter((item) => item.id !== tag.id)],
          )

          if (type === 'agent') {
            // Card edits refresh the catalog after applying the new bindings.
            const refetchType = meta?.deferAgentTagCatalogRefresh ? 'none' : 'active'
            void client.invalidateQueries({ queryKey, refetchType })
          }
        },
      },
    },
    byTagId: {
      patch: {
        mutationOptions: {
          meta: { alsoInvalidate: taggedResources },
          onSuccess: (updatedTag, variables, _onMutateResult, context) => {
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.tags.get.key({ type: 'query' }),
              },
              (oldTags: Tag[] | undefined) => {
                if (!oldTags?.some((tag) => tag.id === variables.params.tag_id)) return
                return oldTags.map((tag) => (tag.id === variables.params.tag_id ? updatedTag : tag))
              },
            )
          },
        },
      },
      delete: {
        mutationOptions: {
          meta: { alsoInvalidate: taggedResources },
          onSuccess: (_data, variables, _onMutateResult, context) => {
            context.client.setQueriesData(
              {
                queryKey: consoleQuery.tags.get.key({ type: 'query' }),
              },
              (oldTags: Tag[] | undefined) => {
                if (!oldTags?.some((tag) => tag.id === variables.params.tag_id)) return
                return oldTags.filter((tag) => tag.id !== variables.params.tag_id)
              },
            )
          },
        },
      },
    },
  }
}

export function invalidateTaggedResources(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  type: Tag['type'],
  targetId?: string,
) {
  if (type === 'agent') {
    return invalidateQueryKeys(client, [
      query.agent.get.key(),
      query.agent.inviteOptions.get.key(),
      query.agent.byAgentId.get.key(
        targetId ? { input: { params: { agent_id: targetId } } } : undefined,
      ),
    ])
  }
  if (type === 'app')
    return invalidateQueryKeys(client, [
      query.apps.get.key(),
      query.apps.starred.get.key(),
      query.apps.recent.get.key(),
    ])
}
