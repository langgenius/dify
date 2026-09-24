import type {
  AgentAppComposerResponse,
  TrialAppDetailResponse,
} from '@dify/contracts/api/console/trial-apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import AgentAppPreview from '../agent-app-preview'

const appDetail = {
  id: 'template-id',
  name: 'Tender Analyst',
  description: 'Review tender documents',
  mode: 'agent',
  enable_api: false,
  enable_site: false,
  site: { title: 'Tender Analyst', default_language: 'en-US', icon_type: 'emoji', icon: '🤖' },
} satisfies TrialAppDetailResponse

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

const builtInTools = [
  {
    id: 'langgenius/web_search/web_search',
    name: 'langgenius/web_search/web_search',
    label: { en_US: 'Web Search' },
    icon: 'https://example.com/web-search.svg',
    tools: [],
  },
]

function createQueryClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(consoleQuery.workspaces.current.summary.get.queryKey(), {
    id: 'workspace-id',
    name: 'Test workspace',
    plan: null,
    credits: null,
    role: 'normal',
  })
  return client
}

describe('AgentAppPreview', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows a read-only Agent configuration alongside the template introduction', async () => {
    const client = createQueryClient()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = input instanceof Request ? input.url : input
        if (url.endsWith('/workspaces/current/tools/builtin')) return Response.json(builtInTools)
        throw new Error(`Unexpected request: ${url}`)
      }),
    )
    render(
      <QueryClientProvider client={client}>
        <AgentAppPreview appDetail={appDetail} composer={composer} />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { name: 'Tender Analyst' })).toBeInTheDocument()
    const model = screen.getByRole('group', {
      name: 'agentV2.agentDetail.configure.model.label',
    })
    expect(within(model).getByText('GPT-4o')).toBeInTheDocument()
    expect(within(model).queryByRole('button')).not.toBeInTheDocument()
    const prompt = screen.getByRole('textbox', {
      name: 'agentV2.agentDetail.configure.prompt.label',
    })
    expect(prompt).toHaveAttribute('contenteditable', 'false')
    expect(prompt).toHaveTextContent('Review the tender files.')
    expect(screen.getByRole('button', { name: 'Tender Analyzer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument()
    expect(screen.getByText('Web Search')).toBeInTheDocument()
    expect(screen.getByText('How can I help?')).toBeInTheDocument()
    expect(screen.getByText('Summarize the requirements')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.files.add' }),
    ).not.toBeInTheDocument()
  })

  it('opens the existing resource dialogs through trial app endpoints', async () => {
    const client = createQueryClient()
    const user = userEvent.setup()
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: Request | string) => {
        const url = input instanceof Request ? input.url : input
        requests.push(url)
        if (url.endsWith('/workspaces/current/tools/builtin')) return Response.json(builtInTools)
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
