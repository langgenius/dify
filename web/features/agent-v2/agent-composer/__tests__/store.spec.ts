import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentSoulConfigWithFiles } from '../conversions'
import { createStore } from 'jotai'
import { describe, expect, it } from 'vitest'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '../conversions'
import { defaultAgentSoulConfigFormState } from '../form-state'
import {
  agentComposerDraftAtom,
  agentComposerOriginalConfigAtom,
  agentComposerOriginalDraftAtom,
  agentComposerPublishedDraftAtom,
  rebaseAgentComposerDraftAtom,
} from '../store'

describe('agent composer store conversions', () => {
  it('rebases draft baselines through the composer state action', () => {
    const store = createStore()
    const nextDraft = {
      ...defaultAgentSoulConfigFormState,
      prompt: 'Build draft prompt',
    }
    const originalConfig = {
      prompt: {
        system_prompt: 'Build draft prompt',
      },
    } satisfies AgentSoulConfig

    store.set(rebaseAgentComposerDraftAtom, {
      draft: nextDraft,
      originalConfig,
    })

    expect(store.get(agentComposerDraftAtom).prompt).toBe('Build draft prompt')
    expect(store.get(agentComposerOriginalDraftAtom)?.prompt).toBe('Build draft prompt')
    expect(store.get(agentComposerPublishedDraftAtom)?.prompt).toBe('Build draft prompt')
    expect(store.get(agentComposerOriginalConfigAtom)?.prompt?.system_prompt).toBe('Build draft prompt')
  })

  it('should hydrate editable form state from an AgentSoulConfig and preserve it in the config snapshot', () => {
    const baseConfig: AgentSoulConfigWithFiles = {
      app_features: {
        opening_statement: 'Hello',
        suggested_questions: ['What changed?'],
      },
      env: {
        variables: [
          {
            key: 'REGION',
            value: 'us-east-1',
          },
        ],
        secret_refs: [
          {
            id: 'secret-1',
            key: 'OPENAI_API_KEY',
            ref: 'credential-1',
            value: 'credential-1',
          },
        ],
      },
      knowledge: {
        sets: [
          {
            id: 'support',
            name: 'Product Docs',
            description: 'Docs corpus',
            datasets: [
              {
                id: 'dataset-1',
                name: 'Product Docs',
                description: 'Docs corpus',
              },
            ],
            query: {
              mode: 'user_query',
              value: 'release notes',
            },
            retrieval: {
              mode: 'multiple',
              top_k: 8,
              score_threshold: 0.72,
              reranking_enable: false,
            },
          },
        ],
      },
      files: {
        skills: [
          {
            id: 'tender-analyzer',
            name: 'Tender Analyzer',
            description: 'Parses RFPs.',
            path: 'tender-analyzer',
            skill_md_key: 'tender-analyzer/SKILL.md',
            full_archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
          },
        ],
        files: [
          {
            id: 'files/sample.pdf',
            file_id: 'drive-file-1',
            name: 'sample.pdf',
            drive_key: 'files/sample.pdf',
          },
        ],
      },
      model: {
        model: 'gpt-4.1',
        model_provider: 'openai',
        plugin_id: 'openai',
      },
      prompt: {
        system_prompt: 'Be precise.',
      },
      tools: {
        cli_tools: [
          {
            tool_name: 'run-tests',
            name: 'Run Tests',
            install_command: 'pnpm install',
            pre_authorized: true,
            env: {
              variables: [
                {
                  key: 'NODE_ENV',
                  value: 'test',
                },
              ],
            },
          },
        ],
        dify_tools: [
          {
            provider: 'DuckDuckGo',
            provider_id: 'duckduckgo',
            provider_type: 'builtin',
            tool_name: 'ddg_search',
            name: 'DuckDuckGo Search',
            description: 'Search the web.',
            runtime_parameters: {
              query: 'latest docs',
              used_in_agent_nodes: true,
            },
          },
        ],
      },
    }

    const formState = agentSoulConfigToFormState(baseConfig)
    const publishConfig = formStateToAgentSoulConfig({
      baseConfig,
      formState,
      currentModel: formState.model,
    })

    expect(formState).toMatchObject({
      prompt: 'Be precise.',
      model: {
        model: 'gpt-4.1',
        provider: 'openai',
        plugin_id: 'openai',
      },
      knowledgeRetrievals: [
        expect.objectContaining({
          id: 'support',
          name: 'Product Docs',
          queryMode: 'custom',
          customQuery: 'release notes',
        }),
      ],
      envVariables: [
        expect.objectContaining({
          key: 'REGION',
          scope: 'plain',
          value: 'us-east-1',
        }),
        expect.objectContaining({
          key: 'OPENAI_API_KEY',
          masked: true,
          scope: 'secret',
          value: 'credential-1',
        }),
      ],
      skills: [
        expect.objectContaining({
          name: 'Tender Analyzer',
          skillMdKey: 'tender-analyzer/SKILL.md',
          archiveKey: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        }),
      ],
      files: [
        expect.objectContaining({
          name: 'sample.pdf',
          fileId: 'drive-file-1',
          driveKey: 'files/sample.pdf',
        }),
      ],
    })
    expect(formState.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'duckduckgo',
        kind: 'provider',
        actions: [
          expect.objectContaining({
            toolName: 'ddg_search',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'run-tests',
        kind: 'cli',
        installCommand: 'pnpm install',
      }),
    ]))
    expect(formState.toolSettings['duckduckgo:ddg_search']).toEqual({
      query: 'latest docs',
      used_in_agent_nodes: true,
    })

    expect(publishConfig).not.toHaveProperty('skills_files')
    expect(publishConfig.files).toEqual({
      skills: [
        {
          id: 'tender-analyzer',
          name: 'Tender Analyzer',
          description: 'Parses RFPs.',
          path: 'tender-analyzer',
          skill_md_key: 'tender-analyzer/SKILL.md',
          full_archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        },
      ],
      files: [
        {
          id: 'files/sample.pdf',
          file_id: 'drive-file-1',
          name: 'sample.pdf',
          drive_key: 'files/sample.pdf',
        },
      ],
    })
    expect(publishConfig.tools?.dify_tools).toEqual([
      expect.objectContaining({
        provider: 'DuckDuckGo',
        provider_id: 'duckduckgo',
        provider_type: 'builtin',
        tool_name: 'ddg_search',
        credential_type: 'unauthorized',
        runtime_parameters: {
          query: 'latest docs',
          used_in_agent_nodes: true,
        },
      }),
    ])
    expect(publishConfig.tools?.dify_tools?.[0]).not.toHaveProperty('name')
    expect(publishConfig.tools?.cli_tools).toEqual([
      expect.objectContaining({
        name: 'Run Tests',
        tool_name: 'run-tests',
        install_command: 'pnpm install',
        enabled: false,
        pre_authorized: false,
      }),
    ])
    expect(publishConfig.knowledge).toMatchObject({
      sets: [
        {
          id: 'support',
          name: 'Product Docs',
          description: 'Docs corpus',
          datasets: [
            {
              id: 'dataset-1',
              name: 'Product Docs',
              description: 'Docs corpus',
            },
          ],
          query: {
            mode: 'user_query',
            value: 'release notes',
          },
          retrieval: {
            mode: 'multiple',
            top_k: 8,
            score_threshold: 0.72,
            reranking_enable: false,
          },
        },
      ],
    })
    expect(publishConfig.env).toMatchObject({
      variables: [
        expect.objectContaining({
          key: 'REGION',
          value: 'us-east-1',
        }),
      ],
      secret_refs: [
        expect.objectContaining({
          key: 'OPENAI_API_KEY',
          value: 'credential-1',
        }),
      ],
    })
  })

  it('should hydrate legacy secret refs from ref when value is absent', () => {
    const formState = agentSoulConfigToFormState({
      env: {
        secret_refs: [
          {
            id: 'secret-1',
            key: 'OPENAI_API_KEY',
            ref: 'credential-legacy',
          },
        ],
      },
    })

    expect(formState.envVariables).toEqual([
      {
        id: 'secret-1',
        key: 'OPENAI_API_KEY',
        masked: true,
        scope: 'secret',
        value: 'credential-legacy',
      },
    ])
  })

  it('should keep unauthorized credential type when no-auth tool settings change', () => {
    const publishConfig = formStateToAgentSoulConfig({
      formState: {
        ...defaultAgentSoulConfigFormState,
        tools: [
          {
            id: 'duckduckgo',
            kind: 'provider',
            name: 'duckduckgo',
            iconClassName: 'i-custom-public-other-default-tool-icon text-text-tertiary',
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
            query: 'updated query',
          },
        },
      },
    })

    expect(publishConfig.tools?.dify_tools).toEqual([
      expect.objectContaining({
        provider_id: 'duckduckgo',
        tool_name: 'ddg_search',
        credential_type: 'unauthorized',
        runtime_parameters: {
          query: 'updated query',
        },
      }),
    ])
  })

  it('should derive model plugin_id from the selected provider when publishing', () => {
    const publishConfig = formStateToAgentSoulConfig({
      baseConfig: {
        model: {
          model: 'gpt-4.1',
          model_provider: 'langgenius/openai/openai',
          plugin_id: 'langgenius/openai',
        },
      },
      formState: defaultAgentSoulConfigFormState,
      currentModel: {
        provider: 'langgenius/anthropic/anthropic',
        model: 'claude-sonnet-4',
      },
    })

    expect(publishConfig.model).toMatchObject({
      model: 'claude-sonnet-4',
      model_provider: 'langgenius/anthropic/anthropic',
      plugin_id: 'langgenius/anthropic',
    })
  })

  it('should not hydrate a knowledge retrieval row when the config has no sets', () => {
    const formState = agentSoulConfigToFormState({
      knowledge: {
        sets: [],
      },
    })

    expect(formState.knowledgeRetrievals).toEqual([])
  })

  it('should keep explicitly cleared selected datasets instead of falling back to dataset refs', () => {
    const publishConfig = formStateToAgentSoulConfig({
      formState: {
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            selectedDatasets: [],
            datasetRefs: [
              {
                id: 'dataset-stale',
                name: 'Stale Docs',
                description: 'Should stay cleared',
              },
            ],
          },
        ],
      },
    })

    expect(publishConfig.knowledge).toMatchObject({
      sets: [
        {
          id: 'retrieval-1',
          datasets: [],
        },
      ],
    })
  })

  it('should round-trip single retrieval model config', () => {
    const baseConfig: AgentSoulConfig = {
      knowledge: {
        sets: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasets: [{ id: 'dataset-1', name: 'Docs' }],
            query: { mode: 'generated_query' },
            retrieval: {
              mode: 'single',
              model: {
                provider: 'langgenius/openai/openai',
                name: 'gpt-4.1',
                mode: 'chat',
                completion_params: { temperature: 0.1 },
              },
            },
          },
        ],
      },
    }

    const formState = agentSoulConfigToFormState(baseConfig)
    const publishConfig = formStateToAgentSoulConfig({ baseConfig, formState })

    expect(formState.knowledgeRetrievals).toEqual([
      expect.objectContaining({
        id: 'retrieval-1',
        retrievalMode: 'single',
        singleRetrievalConfig: {
          model: {
            provider: 'langgenius/openai/openai',
            name: 'gpt-4.1',
            mode: 'chat',
            completion_params: { temperature: 0.1 },
          },
        },
      }),
    ])
    expect(publishConfig.knowledge).toMatchObject({
      sets: [
        {
          id: 'retrieval-1',
          retrieval: {
            mode: 'single',
            model: {
              provider: 'langgenius/openai/openai',
              name: 'gpt-4.1',
              mode: 'chat',
              completion_params: { temperature: 0.1 },
            },
          },
        },
      ],
    })
  })

  it('should round-trip automatic metadata filtering model config', () => {
    const baseConfig: AgentSoulConfig = {
      knowledge: {
        sets: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasets: [{ id: 'dataset-1', name: 'Docs' }],
            query: { mode: 'generated_query' },
            retrieval: { mode: 'multiple', top_k: 4 },
            metadata_filtering: {
              mode: 'automatic',
              model_config: {
                provider: 'langgenius/openai/openai',
                name: 'gpt-4.1-mini',
                mode: 'chat',
                completion_params: { temperature: 0.2 },
              },
            },
          },
        ],
      },
    }

    const formState = agentSoulConfigToFormState(baseConfig)
    const publishConfig = formStateToAgentSoulConfig({ baseConfig, formState })

    expect(formState.knowledgeRetrievals).toEqual([
      expect.objectContaining({
        id: 'retrieval-1',
        metadataFilterMode: 'automatic',
        metadataModelConfig: {
          provider: 'langgenius/openai/openai',
          name: 'gpt-4.1-mini',
          mode: 'chat',
          completion_params: { temperature: 0.2 },
        },
      }),
    ])
    expect(publishConfig.knowledge).toMatchObject({
      sets: [
        {
          id: 'retrieval-1',
          metadata_filtering: {
            mode: 'automatic',
            model_config: {
              provider: 'langgenius/openai/openai',
              name: 'gpt-4.1-mini',
              mode: 'chat',
              completion_params: { temperature: 0.2 },
            },
          },
        },
      ],
    })
  })

  it('should round-trip manual metadata filtering conditions', () => {
    const baseConfig: AgentSoulConfig = {
      knowledge: {
        sets: [
          {
            id: 'retrieval-1',
            name: 'Docs Search',
            datasets: [{ id: 'dataset-1', name: 'Docs' }],
            query: { mode: 'generated_query' },
            retrieval: { mode: 'multiple', top_k: 4 },
            metadata_filtering: {
              mode: 'manual',
              conditions: {
                logical_operator: 'and',
                conditions: [
                  {
                    name: 'language',
                    comparison_operator: 'is',
                    value: 'en',
                  },
                ],
              },
            },
          },
        ],
      },
    }

    const formState = agentSoulConfigToFormState(baseConfig)
    const publishConfig = formStateToAgentSoulConfig({ baseConfig, formState })

    expect(formState.knowledgeRetrievals).toEqual([
      expect.objectContaining({
        id: 'retrieval-1',
        metadataFilterMode: 'manual',
        metadataFilteringConditions: {
          logical_operator: 'and',
          conditions: [
            {
              name: 'language',
              comparison_operator: 'is',
              value: 'en',
            },
          ],
        },
      }),
    ])
    expect(publishConfig.knowledge).toMatchObject({
      sets: [
        {
          id: 'retrieval-1',
          metadata_filtering: {
            mode: 'manual',
            conditions: {
              logical_operator: 'and',
              conditions: [
                {
                  name: 'language',
                  comparison_operator: 'is',
                  value: 'en',
                },
              ],
            },
          },
        },
      ],
    })
  })

  it('should omit incomplete environment variables from the config snapshot', () => {
    const publishConfig = formStateToAgentSoulConfig({
      formState: {
        ...defaultAgentSoulConfigFormState,
        envVariables: [
          {
            id: 'empty-env',
            key: '',
            value: '',
            scope: 'plain',
          },
          {
            id: 'empty-value-env',
            key: 'EMPTY_VALUE',
            value: '',
            scope: 'plain',
          },
          {
            id: 'empty-key-env',
            key: '',
            value: 'secret',
            scope: 'plain',
          },
          {
            id: 'invalid-key-env',
            key: '1BAD',
            value: 'secret',
            scope: 'plain',
          },
          {
            id: 'valid-env',
            key: ' REGION ',
            value: 'us-east-1',
            scope: 'plain',
          },
          {
            id: 'empty-secret',
            key: '',
            value: '',
            scope: 'secret',
          },
          {
            id: 'empty-secret-value',
            key: 'EMPTY_SECRET_VALUE',
            value: '',
            scope: 'secret',
          },
          {
            id: 'invalid-secret-key',
            key: 'BAD-SECRET',
            value: 'secret',
            scope: 'secret',
          },
          {
            id: 'valid-secret',
            key: ' OPENAI_API_KEY ',
            value: '********',
            scope: 'secret',
            masked: true,
          },
        ],
        tools: [
          {
            id: 'run-tests',
            name: 'Run Tests',
            kind: 'cli',
            envVariables: [
              {
                id: 'empty-cli-env',
                key: '',
                value: '',
                scope: 'plain',
              },
              {
                id: 'invalid-cli-env',
                key: 'BAD-CLI',
                value: 'test',
                scope: 'plain',
              },
              {
                id: 'valid-cli-env',
                key: 'NODE_ENV',
                value: 'test',
                scope: 'plain',
              },
            ],
          },
        ],
      },
    })

    expect(publishConfig.env).toEqual({
      variables: [
        {
          id: 'valid-env',
          key: 'REGION',
          name: 'REGION',
          value: 'us-east-1',
          variable: 'REGION',
        },
      ],
      secret_refs: [
        {
          id: 'valid-secret',
          key: 'OPENAI_API_KEY',
          name: 'OPENAI_API_KEY',
          value: '********',
          variable: 'OPENAI_API_KEY',
        },
      ],
    })
    expect(publishConfig.tools?.cli_tools?.[0]?.env).toEqual({
      variables: [
        {
          id: 'valid-cli-env',
          key: 'NODE_ENV',
          name: 'NODE_ENV',
          value: 'test',
          variable: 'NODE_ENV',
        },
      ],
      secret_refs: [],
    })
    expect(publishConfig.tools?.cli_tools?.[0]).toMatchObject({
      enabled: false,
      pre_authorized: false,
    })
  })
})
