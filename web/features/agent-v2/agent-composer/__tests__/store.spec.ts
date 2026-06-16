import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import { describe, expect, it } from 'vitest'
import { agentSoulConfigToFormState, formStateToAgentSoulConfig } from '../conversions'
import { defaultAgentSoulConfigFormState } from '../form-state'

describe('agent composer store conversions', () => {
  it('should hydrate editable form state from an AgentSoulConfig and preserve it in publish payload', () => {
    const baseConfig: AgentSoulConfig = {
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
          },
        ],
      },
      knowledge: {
        datasets: [
          {
            id: 'dataset-1',
            name: 'Product Docs',
            description: 'Docs corpus',
          },
        ],
        query_config: {
          query: 'release notes',
          score_threshold: 0.72,
          score_threshold_enabled: true,
          top_k: 8,
        },
        query_mode: 'user_query',
      },
      model: {
        model: 'gpt-4.1',
        model_provider: 'openai',
        plugin_id: 'openai',
      },
      prompt: {
        system_prompt: 'Be precise.',
      },
      skills_files: {
        files: [
          {
            id: 'file-1',
            name: 'guide.md',
            type: 'markdown',
          },
        ],
        skills: [
          {
            id: 'skill-1',
            file_id: 'archive-file-1',
            full_archive_file_id: 'archive-file-1',
            full_archive_key: 'research-skill/.DIFY-SKILL-FULL.zip',
            name: 'Research Skill',
            path: 'research-skill',
            skill_md_file_id: 'skill-md-file-1',
            skill_md_key: 'research-skill/SKILL.md',
          },
        ],
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
      skills: [
        {
          fileId: 'archive-file-1',
          fullArchiveFileId: 'archive-file-1',
          fullArchiveKey: 'research-skill/.DIFY-SKILL-FULL.zip',
          id: 'skill-1',
          name: 'Research Skill',
          path: 'research-skill',
          skillMdFileId: 'skill-md-file-1',
          skillMdKey: 'research-skill/SKILL.md',
        },
      ],
      files: [
        {
          id: 'file-1',
          name: 'guide.md',
          icon: 'markdown',
        },
      ],
      knowledgeRetrievals: [
        expect.objectContaining({
          id: 'dataset-1',
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

    expect(publishConfig.skills_files).toMatchObject(baseConfig.skills_files!)
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
      datasets: [
        {
          id: 'dataset-1',
          name: 'Product Docs',
          description: 'Docs corpus',
        },
      ],
      query_config: {
        query: 'release notes',
        score_threshold: 0.72,
        score_threshold_enabled: true,
        top_k: 8,
      },
      query_mode: 'user_query',
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
          ref: 'secret-1',
        }),
      ],
    })
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

  it('should not hydrate a knowledge retrieval row when the config has no datasets', () => {
    const formState = agentSoulConfigToFormState({
      knowledge: {
        datasets: [],
        query_config: {
          top_k: 4,
        },
        query_mode: 'generated_query',
      },
    })

    expect(formState.knowledgeRetrievals).toEqual([])
  })

  it('should omit incomplete environment variables from the publish payload', () => {
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
          ref: 'valid-secret',
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
