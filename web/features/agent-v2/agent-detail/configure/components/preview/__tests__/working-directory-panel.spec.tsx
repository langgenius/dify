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
  workflowSandboxFilesQueryOptions: vi.fn(),
  workflowSandboxFileReadQueryOptions: vi.fn(),
  downloadBlob: vi.fn(),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
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

  it('should download the selected working directory file from the preview header action', async () => {
    const user = userEvent.setup()
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('notes.md'))
    await user.click(await screen.findByRole('button', {
      name: /common\.operation\.download.*notes\.md/i,
    }))

    await waitFor(() => {
      expect(mocks.downloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: 'notes.md',
      })
    })
    const blob = mocks.downloadBlob.mock.calls[0]?.[0].data as Blob
    await expect(blob.text()).resolves.toBe('Content for ~/workspace/notes.md')
  })

  it('should show an unsupported preview download placeholder for binary working directory files', async () => {
    const user = userEvent.setup()
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('chart.png'))

    expect(await screen.findByText('agentV2.agentDetail.configure.files.preview.unsupported')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /common\.operation\.download/i })).toHaveAttribute('href', '#')
    expect(screen.queryByRole('button', { name: /common\.operation\.download.*chart\.png/i })).not.toBeInTheDocument()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })
})
