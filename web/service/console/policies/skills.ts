import type { RouterUtils } from '@orpc/tanstack-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
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
        // Writes the published version into the skill's detail, then waits for that detail, the
        // version list the new version appears in, and the skill lists.
        publish: {
          post: {
            mutationOptions: {
              onSuccess: async (version, { params }, _result, { client }) => {
                const detailKey = consoleQuery.workspaces.current.skills.bySkillId.get.queryKey({
                  input: { params: { skill_id: params.skill_id } },
                })
                // Reads started before the publish must not overwrite the written version.
                await cancelSkillDetailCacheReads(consoleQuery, client, detailKey)
                const detail = client.getQueryData(detailKey)
                if (detail)
                  setSkillDetailCache(consoleQuery, client, params.skill_id, {
                    ...detail,
                    latest_published_at: version.created_at,
                    latest_published_version_id: version.id,
                    latest_published_version_number: version.version_number,
                  })
                return invalidateQueryKeys(client, [
                  detailKey,
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
            // Agents list the skills bound to them.
            meta: { alsoInvalidate: ['workspaces.current.agents'] },
            onSuccess: async (skill, { params }, _result, { client }) => {
              const input = { params: { skill_id: params.skill_id } }
              const detailKey = consoleQuery.workspaces.current.skills.bySkillId.get.queryKey({
                input,
              })
              // A detail or list read started before the save must not overwrite it.
              await cancelSkillDetailCacheReads(consoleQuery, client, detailKey)
              const cached = client.getQueryData(detailKey)
              if (cached)
                setSkillDetailCache(consoleQuery, client, params.skill_id, { ...cached, ...skill })
              // The rest of the skill and its lists refresh with the fallback.
              void invalidateQueryKeys(client, [detailKey])
            },
          },
        },
        restore: {
          post: {
            mutationOptions: {
              meta: { alsoInvalidate: ['workspaces.current.agents'] },
              // Waits for the restored skill's detail and the skill lists.
              onSettled: (_data, error, variables, _result, context) => {
                if (error) return
                const input = { params: { skill_id: variables.params.skill_id } }
                const skills = consoleQuery.workspaces.current.skills
                const restored = invalidateQueryKeys(context.client, [
                  skills.bySkillId.get.key({ input }),
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
            meta: { alsoInvalidate: ['workspaces.current.agents'] },
            // Waits for the skill lists it deletes from.
            onSettled: (_data, error, _variables, _result, context) => {
              if (error) return
              return invalidateSkillListQueries(consoleQuery, context.client)
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
              // The agent's composer shows its skills.
              meta: { alsoInvalidate: ['agent'] },
              // Waits for the agent's skill bindings it replaces.
              onSuccess: (_data, { params }, _result, { client }) =>
                invalidateQueryKeys(client, [
                  consoleQuery.workspaces.current.agents.byAgentId.skills.get.key({
                    type: 'query',
                    input: { params: { agent_id: params.agent_id } },
                  }),
                ]),
            },
          },
        },
      },
    },
  }
}

// Cancels the reads `setSkillDetailCache` writes: the skill's detail and the skill lists.
function cancelSkillDetailCacheReads(
  query: RouterUtils<ConsoleClient>,
  client: QueryClient,
  detailKey: QueryKey,
) {
  const { skills } = query.workspaces.current
  return Promise.all([
    client.cancelQueries({ queryKey: detailKey, exact: true }),
    client.cancelQueries({ queryKey: skills.get.key({ type: 'query' }) }),
    client.cancelQueries({ queryKey: skills.get.key({ type: 'infinite' }) }),
  ])
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
