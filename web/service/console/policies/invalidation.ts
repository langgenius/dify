import type { ConsolePolicies } from './types'

// No cached data changes, or the owner reconciles the cache itself.
const skip = { mutationOptions: { meta: { invalidate: false } } } as const

const tagBinding = {
  mutationOptions: {
    meta: {
      alsoInvalidate: [
        'tags',
        'apps',
        'datasets',
        'knowledgeFs',
        'agent',
        'workspaces.current.skills',
      ],
    },
  },
}

/**
 * How the invalidation fallback (`../mutation-invalidation.ts`) treats procedures that no
 * other policy describes. By default every successful console mutation refreshes the active
 * queries of its own domain in the background.
 *
 * - `invalidate: false` skips the fallback: sign-in and generation endpoints that change no
 *   cached data, and autosaves whose policy writes the response, which would otherwise
 *   refetch the whole editor on every keystroke batch.
 * - `alsoInvalidate` names other domains a write changes.
 *
 * A procedure whose policy lives in a domain file declares its `meta` there instead.
 */
export const invalidationPolicies: ConsolePolicies = {
  login: { post: skip },
  logout: { post: skip },
  refreshToken: { post: skip },
  emailCodeLogin: { post: skip, validity: { post: skip } },
  emailRegister: { post: skip, sendEmail: { post: skip }, validity: { post: skip } },
  forgotPassword: { post: skip, resets: { post: skip }, validity: { post: skip } },
  resetPassword: { post: skip },
  instructionGenerate: { post: skip, template: { post: skip } },
  ruleGenerate: { post: skip },
  ruleCodeGenerate: { post: skip },
  ruleStructuredOutputGenerate: { post: skip },
  workflowGenerate: { post: skip, stream: { post: skip }, suggestions: { post: skip } },
  // Binding a tag changes the tag's usage counts and the tagged resource's list row.
  tagBindings: { post: tagBinding, remove: { post: tagBinding } },
  agent: {
    byAgentId: {
      // The preview chat keeps its history current while it streams and remounts on new data,
      // so an unrelated agent write must not refetch it mid-response.
      chatMessages: { get: { queryOptions: { meta: { invalidateAfterWrites: false } } } },
      // Autosaves: their policies write the saved state.
      composer: { put: skip },
      buildDraft: {
        put: skip,
        checkout: { post: skip },
        // The discarded draft is removed by its owner; a refetch would read a missing draft.
        delete: skip,
      },
    },
  },
  apps: {
    byAppId: {
      workflows: {
        draft: {
          nodes: { byNodeId: { agentComposer: { put: skip } } },
        },
      },
    },
  },
  snippets: {
    bySnippetId: {
      workflows: {
        draft: {
          nodes: { byNodeId: { agentComposer: { put: skip } } },
        },
      },
    },
  },
}
