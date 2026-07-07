import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentWorkingDirectoryPanel } from '../working-directory-panel'

type QueryOptionsInput = {
  input: {
    query?: {
      path?: string
    }
  }
}

const mocks = vi.hoisted(() => ({
  sandboxInfoQueryOptions: vi.fn(),
  sandboxFilesQueryOptions: vi.fn(),
  sandboxFileReadQueryOptions: vi.fn(),
  sandboxFileUploadMutationFn: vi.fn(async (_input: unknown) => ({
    path: '~/workspace/notes.md',
    file: {
      transfer_method: 'tool_file',
      reference: 'dify-file-ref:file-1',
    },
  })),
  workflowSandboxFilesQueryOptions: vi.fn(),
  workflowSandboxFileReadQueryOptions: vi.fn(),
  workflowSandboxFileUploadMutationFn: vi.fn(async (_input: unknown) => ({
    path: '~/workspace/notes.md',
    file: {
      transfer_method: 'tool_file',
      reference: 'dify-file-ref:file-1',
    },
  })),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        sandbox: {
          get: {
            queryOptions: mocks.sandboxInfoQueryOptions,
          },
          files: {
            get: {
              queryOptions: mocks.sandboxFilesQueryOptions,
            },
            read: {
              get: {
                queryOptions: mocks.sandboxFileReadQueryOptions,
              },
            },
            upload: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.sandboxFileUploadMutationFn }),
              },
            },
          },
        },
      },
    },
    apps: {
      byAppId: {
        workflowRuns: {
          byWorkflowRunId: {
            agentNodes: {
              byNodeId: {
                sandbox: {
                  files: {
                    get: {
                      queryOptions: mocks.workflowSandboxFilesQueryOptions,
                    },
                    read: {
                      get: {
                        queryOptions: mocks.workflowSandboxFileReadQueryOptions,
                      },
                    },
                    upload: {
                      post: {
                        mutationOptions: () => ({ mutationFn: mocks.workflowSandboxFileUploadMutationFn }),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}))

function renderWorkingDirectoryPanel() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentWorkingDirectoryPanel
        open
        onOpenChange={vi.fn()}
        source={{
          type: 'agent',
          agentId: 'agent-1',
          conversationId: 'conversation-1',
        }}
      />
    </QueryClientProvider>,
  )
}

describe('AgentWorkingDirectoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sandboxInfoQueryOptions.mockImplementation(() => ({
      queryKey: ['sandbox-info'],
      queryFn: async () => ({
        workspace_cwd: 'workspace',
      }),
    }))
    mocks.sandboxFilesQueryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
      queryKey: ['sandbox-files', input],
      queryFn: async () => ({
        path: input.query?.path ?? '~/workspace',
        entries: [
          { name: 'workspace/report.md', type: 'file' },
          { name: 'workspace/notes.md', type: 'file' },
          { name: 'workspace/chart.png', type: 'file' },
        ],
      }),
    }))
    mocks.sandboxFileReadQueryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
      queryKey: ['sandbox-file-read', input],
      queryFn: async () => ({
        binary: input.query?.path?.endsWith('chart.png') ?? false,
        path: input.query?.path ?? '',
        text: input.query?.path?.endsWith('chart.png') ? null : `Content for ${input.query?.path}`,
        truncated: false,
      }),
    }))
  })

  it('should upload the selected working directory file from the preview header download action', async () => {
    const user = userEvent.setup()
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('notes.md'))
    await user.click(await screen.findByRole('button', {
      name: /common\.operation\.download.*notes\.md/i,
    }))

    await waitFor(() => {
      expect(mocks.sandboxFileUploadMutationFn).toHaveBeenCalled()
      expect(mocks.sandboxFileUploadMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          conversation_id: 'conversation-1',
          path: '~/workspace/notes.md',
        },
      })
    })
  })

  it('should upload binary working directory files from the unsupported preview download link', async () => {
    const user = userEvent.setup()
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('chart.png'))

    expect(await screen.findByText('agentV2.agentDetail.configure.files.preview.unsupported')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /common\.operation\.download/i }))

    await waitFor(() => {
      expect(mocks.sandboxFileUploadMutationFn).toHaveBeenCalled()
      expect(mocks.sandboxFileUploadMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          conversation_id: 'conversation-1',
          path: '~/workspace/chart.png',
        },
      })
    })
  })
})
