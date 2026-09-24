import type { AgentAppComposerResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { TryAppInfo } from '@/service/try-app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import AgentAppPreview from '../agent-app-preview'

const appDetail = {
  id: 'template-id',
  name: 'Tender Analyst',
  description: 'Review tender documents',
  mode: 'agent',
  enable_api: false,
  enable_site: false,
  site: { title: 'Tender Analyst', default_language: 'en-US', icon_type: 'emoji', icon: '🤖' },
} satisfies TryAppInfo

const composer = {
  variant: 'agent_app',
  active_config_is_published: true,
  agent: {
    id: 'agent-id',
    name: 'Tender Analyst',
    description: 'Review tender documents',
    scope: 'roster',
    status: 'active',
  },
  agent_soul: {
    model: { model: 'GPT-4o', model_provider: 'openai', plugin_id: 'langgenius/openai' },
    prompt: { system_prompt: 'Review the tender files.' },
    config_skills: [{ name: 'Tender Analyzer' }],
    config_files: [{ name: 'README.md', file_kind: 'upload_file' }],
    knowledge: { sets: [] },
    tools: {
      dify_tools: [
        {
          name: 'Web Search',
          tool_name: 'web_search',
          provider_id: 'langgenius/web_search/web_search',
          provider_type: 'builtin',
        },
      ],
    },
    app_features: {
      opening_statement: 'How can I help?',
      suggested_questions: ['Summarize the requirements'],
    },
  },
  save_options: [],
} satisfies AgentAppComposerResponse

describe('AgentAppPreview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows published Agent configuration and chat introduction without editing actions', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <AgentAppPreview appDetail={appDetail} composer={composer} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('agentV2.agentDetail.configure.model.label')).toBeInTheDocument()
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
    expect(screen.getByText('Tender Analyzer')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('Web Search')).toBeInTheDocument()
    expect(screen.getByText('How can I help?')).toBeInTheDocument()
    expect(screen.getByText('Summarize the requirements')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy|edit|auth/i })).not.toBeInTheDocument()
    expect(client.isFetching()).toBe(0)
  })

  it('opens the existing resource dialogs through trial app endpoints', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const user = userEvent.setup()
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = input instanceof Request ? input.url : input
        requests.push(url)
        if (url.endsWith('/agent/config/skills/Tender%20Analyzer/inspect')) {
          return Response.json({
            id: 'skill-id',
            name: 'Tender Analyzer',
            source: 'config_skill_zip',
            files: [],
            skill_md: {
              binary: false,
              path: 'SKILL.md',
              text: 'Review requirements carefully.',
              truncated: false,
            },
          })
        }
        if (url.endsWith('/agent/config/files/README.md/preview')) {
          return Response.json({
            binary: false,
            name: 'README.md',
            text: 'Template readme',
            truncated: false,
          })
        }
        throw new Error(`Unexpected request: ${url}`)
      }),
    )

    render(
      <QueryClientProvider client={client}>
        <AgentAppPreview appDetail={appDetail} composer={composer} />
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Tender Analyzer' }))
    await waitFor(() => {
      expect(screen.getByText('Review requirements carefully.')).toBeInTheDocument()
    })
    expect(requests).toContain(
      'http://localhost:5001/console/api/trial-apps/template-id/agent/config/skills/Tender%20Analyzer/inspect',
    )
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('button', { name: 'README.md' }))
    await waitFor(() => {
      expect(screen.getByText('Template readme')).toBeInTheDocument()
    })
    expect(requests).toContain(
      'http://localhost:5001/console/api/trial-apps/template-id/agent/config/files/README.md/preview',
    )
  })
})
