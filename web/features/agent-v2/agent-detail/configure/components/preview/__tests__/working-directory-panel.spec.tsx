import { toast } from '@langgenius/dify-ui/toast'
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
    url: 'https://example.com/sandbox-file',
  })),
  workflowSandboxFilesQueryOptions: vi.fn(),
  workflowSandboxFileReadQueryOptions: vi.fn(),
  workflowSandboxFileUploadMutationFn: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/workflow-sandbox-file',
  })),
  sandboxFileUploadClientPost: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/chart.png',
  })),
  workflowSandboxFileUploadClientPost: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/workflow-chart.png',
  })),
  downloadUrl: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    agent: {
      byAgentId: {
        sandbox: {
          files: {
            upload: {
              post: mocks.sandboxFileUploadClientPost,
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
                    upload: {
                      post: mocks.workflowSandboxFileUploadClientPost,
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
                        mutationOptions: () => ({
                          mutationFn: mocks.workflowSandboxFileUploadMutationFn,
                        }),
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

vi.mock('@/utils/download', () => ({
  downloadUrl: mocks.downloadUrl,
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: mocks.toastSuccess,
  },
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

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
          { name: 'workspace/model.bin', type: 'file' },
        ],
      }),
    }))
    mocks.sandboxFileReadQueryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
      queryKey: ['sandbox-file-read', input],
      queryFn: async () => ({
        binary: input.query?.path?.endsWith('model.bin') ?? false,
        path: input.query?.path ?? '',
        text: input.query?.path?.endsWith('model.bin') ? null : `Content for ${input.query?.path}`,
        truncated: false,
      }),
    }))
  })

  it('should download the selected working directory file from the preview header download action', async () => {
    const user = userEvent.setup()
    const upload = createDeferred<{ url: string }>()
    mocks.sandboxFileUploadMutationFn.mockReturnValueOnce(upload.promise)
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('notes.md'))
    await user.click(
      await screen.findByRole('button', {
        name: /common\.operation\.download.*notes\.md/i,
      }),
    )

    const downloadingButton = await screen.findByRole('button', {
      name: /common\.operation\.downloading.*notes\.md/i,
    })
    expect(downloadingButton.querySelector('.animate-spin')).toBeInTheDocument()

    upload.resolve({ url: 'https://example.com/sandbox-file' })

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
      expect(mocks.downloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/sandbox-file',
        fileName: 'notes.md',
      })
      expect(toast.success).toHaveBeenCalledWith('common.operation.downloadSuccess')
    })
  })

  it('should download binary working directory files from the unsupported preview download link', async () => {
    const user = userEvent.setup()
    const upload = createDeferred<{ url: string }>()
    mocks.sandboxFileUploadMutationFn.mockReturnValueOnce(upload.promise)
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('model.bin'))

    expect(
      await screen.findByText('agentV2.agentDetail.configure.files.preview.unsupported'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /common\.operation\.download/i }))

    const downloadingLink = await screen.findByRole('link', {
      name: /common\.operation\.downloading/i,
    })
    expect(downloadingLink.querySelector('.animate-spin')).toBeInTheDocument()
    const headerDownloadButton = screen.getByRole('button', {
      name: /common\.operation\.download.*model\.bin/i,
    })
    expect(headerDownloadButton.querySelector('.animate-spin')).not.toBeInTheDocument()

    upload.resolve({ url: 'https://example.com/sandbox-file' })

    await waitFor(() => {
      expect(mocks.sandboxFileUploadMutationFn).toHaveBeenCalled()
      expect(mocks.sandboxFileUploadMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          conversation_id: 'conversation-1',
          path: '~/workspace/model.bin',
        },
      })
      expect(mocks.downloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/sandbox-file',
        fileName: 'model.bin',
      })
      expect(toast.success).toHaveBeenCalledWith('common.operation.downloadSuccess')
    })
  })

  it('should preview sandbox images with the uploaded file url', async () => {
    const user = userEvent.setup()
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('chart.png'))

    await waitFor(() => {
      expect(mocks.sandboxFileUploadClientPost).toHaveBeenCalled()
    })
    const image = await screen.findByAltText('chart.png')
    expect(image).toHaveAttribute('src', 'https://example.com/chart.png')
    expect(mocks.sandboxFileUploadClientPost).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        conversation_id: 'conversation-1',
        path: '~/workspace/chart.png',
      },
    })
    expect(
      screen.queryByText('agentV2.agentDetail.configure.files.preview.unsupported'),
    ).not.toBeInTheDocument()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
  })
})
