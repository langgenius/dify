import type { AgentProviderToolDefaultValue } from '../tools'
import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { defaultAgentSoulConfigFormState } from '../../form-state'
import { agentComposerDraftAtom } from '../../store'
import {
  addProviderTools,
  addProviderToolsAtom,
  removeProviderToolActionAtom,
  saveCliToolAtom,
} from '../tools'

const noCredentialTool = {
  provider_id: 'duckduckgo',
  provider_type: 'builtin',
  provider_name: 'DuckDuckGo',
  provider_show_name: 'DuckDuckGo',
  tool_name: 'ddg_search',
  tool_label: 'DuckDuckGo Search',
  tool_description: 'Search the web.',
  title: 'DuckDuckGo Search',
  is_team_authorization: true,
  params: {},
  paramSchemas: [],
  allowDelete: false,
  credentialRequired: false,
} satisfies AgentProviderToolDefaultValue

const unauthorizedCredentialTool = {
  ...noCredentialTool,
  provider_id: 'google',
  provider_name: 'google',
  provider_show_name: 'Google',
  tool_name: 'search',
  tool_label: 'Google Search',
  title: 'Google Search',
  is_team_authorization: false,
  credentialRequired: true,
} satisfies AgentProviderToolDefaultValue

const unauthorizedOAuthTool = {
  ...unauthorizedCredentialTool,
  provider_id: 'slack',
  provider_name: 'slack',
  provider_show_name: 'Slack',
  credentialType: 'oauth2',
} satisfies AgentProviderToolDefaultValue

describe('agent composer tools store', () => {
  describe('addProviderTools', () => {
    it('should not mark tools that do not need credentials as unauthorized', () => {
      const nextTools = addProviderTools([], [noCredentialTool])

      expect(nextTools).toEqual([
        expect.objectContaining({
          credentialId: undefined,
          credentialType: undefined,
          credentialVariant: 'none',
        }),
      ])
    })

    it('should mark credential-required tools without credentials as unauthorized', () => {
      const nextTools = addProviderTools([], [unauthorizedCredentialTool])

      expect(nextTools).toEqual([
        expect.objectContaining({
          credentialId: undefined,
          credentialType: 'unauthorized',
          credentialVariant: 'unauthorized',
        }),
      ])
    })

    it('should preserve oauth credential type for credential-required OAuth tools', () => {
      const nextTools = addProviderTools([], [unauthorizedOAuthTool])

      expect(nextTools).toEqual([
        expect.objectContaining({
          credentialId: undefined,
          credentialType: 'oauth2',
          credentialVariant: 'unauthorized',
        }),
      ])
    })
  })

  describe('write actions', () => {
    it('should apply provider and CLI updates against the latest draft tools', () => {
      const store = createStore()
      store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)

      store.set(addProviderToolsAtom, [noCredentialTool])
      store.set(saveCliToolAtom, {
        id: 'cli-tool',
        kind: 'cli',
        name: 'CLI Tool',
        installCommand: 'pnpm install',
      })
      store.set(addProviderToolsAtom, [unauthorizedCredentialTool])

      expect(store.get(agentComposerDraftAtom).tools).toEqual([
        expect.objectContaining({
          id: 'duckduckgo',
          kind: 'provider',
        }),
        expect.objectContaining({
          id: 'cli-tool',
          kind: 'cli',
        }),
        expect.objectContaining({
          id: 'google',
          kind: 'provider',
        }),
      ])
    })

    it('should update existing CLI tools instead of appending duplicates', () => {
      const store = createStore()
      store.set(agentComposerDraftAtom, defaultAgentSoulConfigFormState)

      store.set(saveCliToolAtom, {
        id: 'cli-tool',
        kind: 'cli',
        name: 'CLI Tool',
      })
      store.set(saveCliToolAtom, {
        id: 'cli-tool',
        kind: 'cli',
        name: 'Updated CLI Tool',
        installCommand: 'pnpm install',
      })

      expect(store.get(agentComposerDraftAtom).tools).toEqual([
        {
          id: 'cli-tool',
          kind: 'cli',
          name: 'Updated CLI Tool',
          installCommand: 'pnpm install',
        },
      ])
    })

    it('should remove provider action settings with the action', () => {
      const store = createStore()
      store.set(agentComposerDraftAtom, {
        ...defaultAgentSoulConfigFormState,
        tools: [
          {
            id: 'duckduckgo',
            kind: 'provider',
            name: 'DuckDuckGo',
            iconClassName: 'i-simple-icons-duckduckgo',
            credentialVariant: 'none',
            actions: [
              {
                id: 'duckduckgo:ddg_search',
                name: 'DuckDuckGo Search',
                toolName: 'ddg_search',
                description: 'Search the web.',
              },
            ],
          },
        ],
        toolSettings: {
          'duckduckgo:ddg_search': {
            query: 'docs',
          },
        },
      })

      store.set(removeProviderToolActionAtom, {
        toolId: 'duckduckgo',
        actionId: 'duckduckgo:ddg_search',
      })

      expect(store.get(agentComposerDraftAtom).tools).toEqual([])
      expect(store.get(agentComposerDraftAtom).toolSettings).toEqual({})
    })
  })
})
