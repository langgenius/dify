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
      // Creates wait for the skill lists the new skill appears in; tags refresh in the background.
      post: {
        mutationOptions: {
          onSuccess: (_data, _variables, _result, { client }) =>
            invalidateSkillListQueries(consoleQuery, client),
        },
      },
      import: {
        post: {
          mutationOptions: {
            onSuccess: (_data, _variables, _result, { client }) =>
              invalidateSkillListQueries(consoleQuery, client),
          },
        },
      },
      bySkillId: {
        duplicate: {
          post: {
            mutationOptions: {
              onSuccess: (_data, _variables, _result, { client }) =>
                invalidateSkillListQueries(consoleQuery, client),
            },
          },
        },
        // The publisher writes the published detail itself; waits for the version list the new
        // version appears in and the skill lists.
        publish: {
          post: {
            mutationOptions: {
              onSuccess: (_data, { params }, _result, { client }) =>
                invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.skills.bySkillId.versions.get.key({
                    type: 'query',
                    input: { params: { skill_id: params.skill_id } },
                  }),
                  consoleQuery.workspaces.current.skills.get.key({ type: 'query' }),
                  consoleQuery.workspaces.current.skills.get.key({ type: 'infinite' }),
                ]),
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
              // Waits for the restored skill's detail and the skill lists; versions and agent
              // bindings refresh in the background.
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                const input = { params: { skill_id: variables.params.skill_id } }
                const skills = consoleQuery.workspaces.current.skills
                const restored = invalidateQueryKeys(context.client, [
                  skills.bySkillId.get.key({ input }),
                ])
                void invalidateQueryKeys(context.client, [
                  skills.bySkillId.versions.get.key({ input }),
                  consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
                ])
                return Promise.all([
                  restored,
                  invalidateQueryKeys(context.client, [skills.get.key()]),
                ])
              },
            },
          },
        },
        versions: {
          byVersionId: {
            patch: {
              mutationOptions: {
                // Waits for the version list and the edited version; the skill detail and agent
                // bindings refresh in the background.
                onSuccess: (_data, { params }, _result, { client }) => {
                  const { versions } = consoleQuery.workspaces.current.skills.bySkillId
                  return Promise.all([
                    invalidateSkillVersionQueries(consoleQuery, client, params.skill_id),
                    invalidateQueryKeys(client, [
                      versions.byVersionId.get.key({ input: { params } }),
                    ]),
                  ])
                },
              },
            },
            delete: {
              mutationOptions: {
                // Waits for the version list it deletes from; the skill detail and agent bindings
                // refresh in the background.
                onSettled: (_data, error, variables, _result, context) => {
                  if (error) return
                  return invalidateSkillVersionQueries(
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
              // Waits for the skill lists it deletes from; tags and agent bindings refresh in the
              // background.
              const lists = invalidateSkillListQueries(consoleQuery, context.client)
              void invalidateQueryKeys(context.client, [
                consoleQuery.workspaces.current.agents.byAgentId.skills.get.key(),
              ])
              return lists
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
              // Waits for the agent's skill bindings it replaces; the composer refreshes in the
              // background.
              onSuccess: (_data, { params }, _result, { client }) => {
                const input = { params: { agent_id: params.agent_id } }
                const bindings = invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({
                    type: 'query',
                    input,
                  }),
                ])
                void invalidateQueryKeys(client, [
                  consoleQuery.agent.byAgentId.composer.get.key({ type: 'query', input }),
                ])
                return bindings
              },
            },
          },
        },
      },
    },
  }
}

// Refreshes a skill's versions; the returned promise waits for the version list only.
export function invalidateSkillVersionQueries(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  skillId: string,
) {
  const input = { params: { skill_id: skillId } }
  void invalidateQueryKeys(client, [query.workspaces.current.skills.bySkillId.get.key({ input })])
  const versions = invalidateQueryKeys(client, [
    query.workspaces.current.skills.bySkillId.versions.get.key({ input }),
  ])
  void invalidateQueryKeys(client, [query.workspaces.current.agents.byAgentId.skills.get.key()])
  return versions
}

// Refreshes the skill lists and tags; the returned promise waits for the lists only.
function invalidateSkillListQueries(query: RouterUtils<ConsoleClient>, client: QueryClient) {
  const lists = invalidateQueryKeys(client, [
    query.workspaces.current.skills.get.key({ type: 'query' }),
    query.workspaces.current.skills.get.key({ type: 'infinite' }),
  ])
  void invalidateQueryKeys(client, [
    query.workspaces.current.skills.tags.get.key({ type: 'query' }),
  ])
  return lists
}
