import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ConsoleClient } from '../index'
import type { ConsoleQuery, WorkspaceCurrentPolicies } from './types'
import { setSkillDetailCache } from '../skill-cache'
import { invalidateQueryKeys } from './shared'

export function skillPolicies(
  consoleQuery: ConsoleQuery,
): Pick<WorkspaceCurrentPolicies, 'skills' | 'agents'> {
  return {
    skills: {
      // A new skill shows in the lists; the caller navigates without waiting for them.
      post: {
        mutationOptions: {
          onSuccess: (_data, _variables, _result, { client }) => {
            void invalidateSkillListQueries(consoleQuery, client)
          },
        },
      },
      import: {
        post: {
          mutationOptions: {
            onSuccess: (_data, _variables, _result, { client }) => {
              void invalidateSkillListQueries(consoleQuery, client)
            },
          },
        },
      },
      bySkillId: {
        duplicate: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, { client }) => {
                void invalidateSkillListQueries(consoleQuery, client)
              },
            },
          },
        },
        // The publisher writes the published detail itself and waits for it; versions and
        // lists refresh in the background.
        publish: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) => {
                void invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
                    type: 'query',
                    input: { params: { skill_id: params.skill_id } },
                  }),
                  consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
                  consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
                ])
              },
            },
          },
        },
        // Metadata writes return the skill without its files, and a rename rewrites
        // SKILL.md: merge the response into the cached detail, then refetch it.
        patch: {
          mutationOptions: {
            onSuccess: async (skill, { params, body }, _result, { client }) => {
              const input = { params: { skill_id: params.skill_id } }
              const detailKey = consoleQuery.workspaces.current.skills.bySkillId.get.queryKey({
                input,
              })
              // A detail refetch started before the save must not overwrite it.
              await client.cancelQueries({ queryKey: detailKey })
              const cached = client.getQueryData(detailKey)
              if (cached)
                setSkillDetailCache(consoleQuery, client, params.skill_id, { ...cached, ...skill })
              void invalidateQueryKeys(client, [
                detailKey,
                consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({ input }),
                consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
                consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
                ...(body.tags ? [consoleQuery.workspaces.current.skills.tags.get.key()] : []),
              ])
            },
          },
        },
        restore: {
          post: {
            mutationOptions: {
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                void invalidateSkillVersionQueries(
                  consoleQuery,
                  context.client,
                  variables.params.skill_id,
                )
                void context.client.invalidateQueries({
                  queryKey: consoleQuery.workspaces.current.skills.get.key(),
                })
              },
            },
          },
        },
        versions: {
          byVersionId: {
            patch: {
              mutationOptions: {
                onSuccess: (_data, { params }, _result, { client }) => {
                  void invalidateSkillVersionQueries(consoleQuery, client, params.skill_id)
                  void client.invalidateQueries({
                    queryKey:
                      consoleQuery.workspaces.current.skills.bySkillId.versions.byVersionId.get.key(
                        { input: { params } },
                      ),
                  })
                },
              },
            },
            delete: {
              mutationOptions: {
                onSettled: (_data, error, variables, _result, context) => {
                  if (error) return
                  void invalidateSkillVersionQueries(
                    consoleQuery,
                    context.client,
                    variables.params.skill_id,
                  )
                },
              },
            },
          },
        },
        delete: {
          mutationOptions: {
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              void invalidateSkillListQueries(consoleQuery, context.client)
              return context.client.invalidateQueries({
                queryKey: consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
              })
            },
          },
        },
      },
    },
    agents: {
      byAgentId: {
        skills: {
          put: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) => {
                const input = { params: { agent_id: params.agent_id } }
                void invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({
                    type: 'query',
                    input,
                  }),
                  consoleQuery.agent.byAgentId.composer.get.key({ type: 'query', input }),
                ])
              },
            },
          },
        },
      },
    },
  }
}

export function invalidateSkillVersionQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  skillId: string,
) {
  const input = { params: { skill_id: skillId } }
  return invalidateQueryKeys(client, [
    query.workspaces.current.skills.bySkillId.get.key({ input }),
    query.workspaces.current.skills.bySkillId.versions.get.key({ input }),
    query.workspaces.current.agents.byAgentId.skills.get.key(),
  ])
}

function invalidateSkillListQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  return invalidateQueryKeys(client, [
    query.workspaces.current.skills.get.key({ type: 'query' }),
    query.workspaces.current.skills.get.key({ type: 'infinite' }),
    query.workspaces.current.skills.tags.get.key({ type: 'query' }),
  ])
}
