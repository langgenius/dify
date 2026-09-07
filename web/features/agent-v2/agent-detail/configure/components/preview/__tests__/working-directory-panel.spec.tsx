import type { AgentWorkingDirectorySource } from '../working-directory-panel'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
  sandboxFileDownloadMutationFn: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/sandbox-file',
  })),
  workflowSandboxFilesQueryOptions: vi.fn(),
  workflowSandboxFileReadQueryOptions: vi.fn(),
  workflowSandboxFileDownloadMutationFn: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/workflow-sandbox-file',
  })),
  sandboxFileDownloadClientPost: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/chart.png',
  })),
  workflowSandboxFileDownloadClientPost: vi.fn(async (_input: unknown) => ({
    url: 'https://example.com/workflow-chart.png',
  })),
  downloadUrl: vi.fn(),
  toastSuccess: vi.fn(),
}))

const agentSource = {
  type: 'agent',
  agentId: 'agent-1',
  callerType: 'conversation',
  callerId: 'conversation-1',
} satisfies AgentWorkingDirectorySource

const workflowSource = {
  type: 'workflow-node',
  appId: 'app-1',
  workflowRunId: 'run-1',
  nodeId: 'node-1',
  nodeExecutionId: 'execution-1',
} satisfies AgentWorkingDirectorySource

const previewSourceCases = [
  {
    label: 'Agent',
    source: agentSource,
    identitySource: {
      ...agentSource,
      callerId: 'conversation-2',
    } satisfies AgentWorkingDirectorySource,
    imagePaths: ['chart-a.png', 'chart-b.png'],
    nonImagePath: 'model.bin',
    previewClient: mocks.sandboxFileDownloadClientPost,
    urls: [
      'https://example.com/agent-chart-a.png',
      'https://example.com/agent-chart-caller-b.png',
      'https://example.com/agent-chart-path-c.png',
    ],
  },
  {
    label: 'Workflow',
    source: workflowSource,
    identitySource: {
      ...workflowSource,
      nodeExecutionId: 'execution-2',
    } satisfies AgentWorkingDirectorySource,
    imagePaths: ['chart-a.png', 'chart-b.png'],
    nonImagePath: 'model.bin',
    previewClient: mocks.workflowSandboxFileDownloadClientPost,
    urls: [
      'https://example.com/workflow-chart-a.png',
      'https://example.com/workflow-chart-execution-b.png',
      'https://example.com/workflow-chart-path-c.png',
    ],
  },
] as const

vi.mock('@/service/client', () => ({
  consoleClient: {
    agent: {
      byAgentId: {
        sandbox: {
          files: {
            download: {
              post: mocks.sandboxFileDownloadClientPost,
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
                    download: {
                      post: mocks.workflowSandboxFileDownloadClientPost,
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
            download: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.sandboxFileDownloadMutationFn }),
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
                    download: {
                      post: {
                        mutationOptions: () => ({
                          mutationFn: mocks.workflowSandboxFileDownloadMutationFn,
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
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, reject, resolve }
}

type RenderWorkingDirectoryPanelOptions = {
  open?: boolean
  source?: AgentWorkingDirectorySource
}

function renderWorkingDirectoryPanel({
  open = true,
  source = agentSource,
}: RenderWorkingDirectoryPanelOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <AgentWorkingDirectoryPanel open={open} onOpenChange={vi.fn()} source={source} />
    </QueryClientProvider>,
  )
  return {
    ...rendered,
    rerenderPanel: (nextOptions: Required<RenderWorkingDirectoryPanelOptions>) => {
      rendered.rerender(
        <QueryClientProvider client={queryClient}>
          <AgentWorkingDirectoryPanel
            open={nextOptions.open}
            onOpenChange={vi.fn()}
            source={nextOptions.source}
          />
        </QueryClientProvider>,
      )
    },
  }
}

function renderWorkflowWorkingDirectoryPanel() {
  return renderWorkingDirectoryPanel({ source: workflowSource })
}

function mockFileListEntries(
  source: AgentWorkingDirectorySource,
  entries: Array<{ name: string; type: 'file' }>,
) {
  const queryOptions =
    source.type === 'agent'
      ? mocks.sandboxFilesQueryOptions
      : mocks.workflowSandboxFilesQueryOptions
  queryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
    queryKey: [`${source.type}-sandbox-files`, input, entries],
    queryFn: async () => ({
      path: input.query?.path ?? '~',
      entries,
    }),
  }))
}

function mockFileReadAsBinary(source: AgentWorkingDirectorySource) {
  const queryOptions =
    source.type === 'agent'
      ? mocks.sandboxFileReadQueryOptions
      : mocks.workflowSandboxFileReadQueryOptions
  queryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
    queryKey: [`${source.type}-sandbox-file-read`, input],
    queryFn: async () => ({
      binary: true,
      path: input.query?.path ?? '',
      text: null,
      truncated: false,
    }),
  }))
}

function expectedImagePreviewRequest(source: AgentWorkingDirectorySource, path: string) {
  if (source.type === 'agent') {
    return {
      params: { agent_id: source.agentId },
      body: {
        caller_type: source.callerType,
        caller_id: source.callerId,
        path: `~/${path}`,
      },
    }
  }

  return {
    params: {
      app_id: source.appId,
      workflow_run_id: source.workflowRunId,
      node_id: source.nodeId,
    },
    body: {
      node_execution_id: source.nodeExecutionId,
      path: `~/${path}`,
    },
  }
}

function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
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
        path: input.query?.path ?? '~',
        entries: [
          { name: 'report.md', type: 'file' },
          { name: 'notes.md', type: 'file' },
          { name: 'chart.png', type: 'file' },
          { name: 'model.bin', type: 'file' },
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
    mocks.workflowSandboxFilesQueryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
      queryKey: ['workflow-sandbox-files', input],
      queryFn: async () => ({
        path: input.query?.path ?? '.',
        entries: [{ name: 'chart.png', type: 'file' }],
      }),
    }))
    mocks.workflowSandboxFileReadQueryOptions.mockImplementation(
      ({ input }: QueryOptionsInput) => ({
        queryKey: ['workflow-sandbox-file-read', input],
        queryFn: async () => ({
          binary: false,
          path: input.query?.path ?? '',
          text: null,
          truncated: false,
        }),
      }),
    )
  })

  it('should separate persistent and temporary files by their sandbox path roots', async () => {
    const user = userEvent.setup()
    mocks.sandboxFilesQueryOptions.mockImplementation(({ input }: QueryOptionsInput) => ({
      queryKey: ['sandbox-files-by-root', input],
      queryFn: async () => ({
        path: input.query?.path ?? '~',
        entries:
          input.query?.path === '.'
            ? [{ name: 'scratch.txt', type: 'file' }]
            : [{ name: 'saved.txt', type: 'file' }],
      }),
    }))
    renderWorkingDirectoryPanel()

    const persistentFilesTab = await screen.findByRole('tab', {
      name: 'agentV2.agentDetail.configure.workingDirectory.persistentFiles',
    })
    const temporaryFilesTab = screen.getByRole('tab', {
      name: 'agentV2.agentDetail.configure.workingDirectory.temporaryFiles',
    })

    expect(persistentFilesTab).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByRole('tabpanel', {
        name: 'agentV2.agentDetail.configure.workingDirectory.persistentFiles',
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.sandboxFilesQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            query: expect.objectContaining({ path: '~' }),
          }),
        }),
      )
    })

    await user.click(temporaryFilesTab)

    await waitFor(() => {
      expect(
        screen.getByRole('tab', {
          name: 'agentV2.agentDetail.configure.workingDirectory.temporaryFiles',
        }),
      ).toHaveAttribute('aria-selected', 'true')
    })
    expect(
      screen.getByRole('tabpanel', {
        name: 'agentV2.agentDetail.configure.workingDirectory.temporaryFiles',
      }),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(mocks.sandboxFilesQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            query: expect.objectContaining({ path: '.' }),
          }),
        }),
      )
    })
    await waitFor(() => {
      expect(mocks.sandboxFileReadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            query: expect.objectContaining({ path: './scratch.txt' }),
          }),
        }),
      )
    })
    expect(mocks.sandboxInfoQueryOptions).not.toHaveBeenCalled()
  })

  it('should download the selected working directory file from the preview header download action', async () => {
    const user = userEvent.setup()
    const download = createDeferred<{ url: string }>()
    mocks.sandboxFileDownloadMutationFn.mockReturnValueOnce(download.promise)
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
    await user.click(downloadingButton)
    expect(mocks.sandboxFileDownloadMutationFn).toHaveBeenCalledTimes(1)

    download.resolve({ url: 'https://example.com/sandbox-file' })

    await waitFor(() => {
      expect(mocks.sandboxFileDownloadMutationFn).toHaveBeenCalled()
      expect(mocks.sandboxFileDownloadMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          caller_type: 'conversation',
          caller_id: 'conversation-1',
          path: '~/notes.md',
        },
      })
      expect(mocks.downloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/sandbox-file',
        fileName: 'notes.md',
      })
      expect(toast.success).toHaveBeenCalledWith('common.operation.downloadSuccess')
    })
  })

  it('should explain the lifetime of persistent and temporary files', async () => {
    const user = userEvent.setup()
    renderWorkingDirectoryPanel()

    const persistentFilesTooltip =
      'agentV2.agentDetail.configure.workingDirectory.persistentFilesTooltip'
    const temporaryFilesTooltip =
      'agentV2.agentDetail.configure.workingDirectory.temporaryFilesTooltip'

    await user.click(
      await screen.findByRole('button', {
        name: persistentFilesTooltip,
      }),
    )
    expect(await screen.findByText(persistentFilesTooltip)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: temporaryFilesTooltip,
      }),
    )
    expect(await screen.findByText(temporaryFilesTooltip)).toBeInTheDocument()
  })

  it('should download binary working directory files from the unsupported preview download link', async () => {
    const user = userEvent.setup()
    const download = createDeferred<{ url: string }>()
    mocks.sandboxFileDownloadMutationFn.mockReturnValueOnce(download.promise)
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

    download.resolve({ url: 'https://example.com/sandbox-file' })

    await waitFor(() => {
      expect(mocks.sandboxFileDownloadMutationFn).toHaveBeenCalled()
      expect(mocks.sandboxFileDownloadMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          caller_type: 'conversation',
          caller_id: 'conversation-1',
          path: '~/model.bin',
        },
      })
      expect(mocks.downloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/sandbox-file',
        fileName: 'model.bin',
      })
      expect(toast.success).toHaveBeenCalledWith('common.operation.downloadSuccess')
    })
  })

  it('should preview sandbox images with the downloaded file url', async () => {
    const user = userEvent.setup()
    const download = createDeferred<{ url: string }>()
    mocks.sandboxFileDownloadClientPost.mockReturnValueOnce(download.promise)
    renderWorkingDirectoryPanel()

    await user.click(await screen.findByText('chart.png'))

    await waitFor(() => {
      expect(mocks.sandboxFileDownloadClientPost).toHaveBeenCalled()
    })
    download.resolve({ url: 'https://example.com/chart.png' })

    const image = await screen.findByAltText('chart.png')
    expect(image).toHaveAttribute('src', 'https://example.com/chart.png')
    expect(mocks.sandboxFileDownloadClientPost).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      body: {
        caller_type: 'conversation',
        caller_id: 'conversation-1',
        path: '~/chart.png',
      },
    })
    expect(
      screen.queryByText('agentV2.agentDetail.configure.files.preview.unsupported'),
    ).not.toBeInTheDocument()
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
  })

  it.each(previewSourceCases)(
    'should refresh $label image previews when caller ownership or path changes',
    async ({ source, identitySource, imagePaths, previewClient, urls }) => {
      const user = userEvent.setup()
      const [initialImagePath, nextImagePath] = imagePaths
      const [initialUrl, identityUrl, pathUrl] = urls
      mockFileListEntries(
        source,
        imagePaths.map((name) => ({ name, type: 'file' })),
      )
      previewClient
        .mockResolvedValueOnce({ url: initialUrl })
        .mockResolvedValueOnce({ url: identityUrl })
        .mockResolvedValueOnce({ url: pathUrl })
      const { rerenderPanel } = renderWorkingDirectoryPanel({ source })

      expect(await screen.findByAltText(fileName(initialImagePath))).toHaveAttribute(
        'src',
        initialUrl,
      )
      expect(previewClient).toHaveBeenCalledTimes(1)

      rerenderPanel({ open: true, source: identitySource })

      await waitFor(() => {
        expect(previewClient).toHaveBeenCalledTimes(2)
        expect(screen.getByAltText(fileName(initialImagePath))).toHaveAttribute('src', identityUrl)
      })
      expect(previewClient).toHaveBeenNthCalledWith(
        2,
        expectedImagePreviewRequest(identitySource, initialImagePath),
      )

      await user.click(await screen.findByText(fileName(nextImagePath)))

      await waitFor(() => {
        expect(previewClient).toHaveBeenCalledTimes(3)
        expect(screen.getByAltText(fileName(nextImagePath))).toHaveAttribute('src', pathUrl)
      })
      expect(previewClient).toHaveBeenNthCalledWith(
        3,
        expectedImagePreviewRequest(identitySource, nextImagePath),
      )
    },
  )

  it.each(previewSourceCases)(
    'should disable $label image preview requests while closed and for non-images',
    async ({ source, identitySource, imagePaths, nonImagePath, previewClient, urls }) => {
      const [imagePath] = imagePaths
      const [firstUrl] = urls
      mockFileListEntries(source, [{ name: imagePath, type: 'file' }])
      previewClient.mockResolvedValueOnce({ url: firstUrl })
      const { rerenderPanel, unmount } = renderWorkingDirectoryPanel({ source })

      expect(await screen.findByAltText(fileName(imagePath))).toHaveAttribute('src', firstUrl)
      expect(previewClient).toHaveBeenCalledTimes(1)
      previewClient.mockClear()

      rerenderPanel({ open: false, source: identitySource })
      await waitFor(() => {
        expect(screen.queryByAltText(fileName(imagePath))).not.toBeInTheDocument()
      })
      expect(previewClient).toHaveBeenCalledTimes(0)
      unmount()

      mockFileListEntries(source, [{ name: nonImagePath, type: 'file' }])
      mockFileReadAsBinary(source)
      renderWorkingDirectoryPanel({ source })
      expect(
        await screen.findByText('agentV2.agentDetail.configure.files.preview.unsupported'),
      ).toBeInTheDocument()
      expect(previewClient).toHaveBeenCalledTimes(0)
    },
  )

  it('should download workflow files from the exact node execution', async () => {
    const user = userEvent.setup()
    const download = createDeferred<{ url: string }>()
    mocks.workflowSandboxFileDownloadMutationFn.mockReturnValueOnce(download.promise)
    renderWorkflowWorkingDirectoryPanel()

    await user.click(
      await screen.findByRole('button', {
        name: /common\.operation\.download.*chart\.png/i,
      }),
    )

    expect(
      await screen.findByRole('button', {
        name: /common\.operation\.downloading.*chart\.png/i,
      }),
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.downloading.*chart\.png/i,
      }),
    )
    expect(mocks.workflowSandboxFileDownloadMutationFn).toHaveBeenCalledTimes(1)

    download.resolve({ url: 'https://example.com/workflow-sandbox-file' })

    await waitFor(() => {
      expect(mocks.workflowSandboxFileDownloadMutationFn).toHaveBeenCalled()
      expect(mocks.workflowSandboxFileDownloadMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
          workflow_run_id: 'run-1',
          node_id: 'node-1',
        },
        body: {
          node_execution_id: 'execution-1',
          path: '~/chart.png',
        },
      })
      expect(mocks.downloadUrl).toHaveBeenCalledWith({
        url: 'https://example.com/workflow-sandbox-file',
        fileName: 'chart.png',
      })
      expect(toast.success).toHaveBeenCalledWith('common.operation.downloadSuccess')
    })
  })

  it('should clear Agent download pending state without reporting success after failure', async () => {
    const user = userEvent.setup()
    const download = createDeferred<{ url: string }>()
    mocks.sandboxFileDownloadMutationFn.mockReturnValueOnce(download.promise)
    renderWorkingDirectoryPanel()

    await user.click(
      await screen.findByRole('button', {
        name: /common\.operation\.download.*report\.md/i,
      }),
    )
    expect(
      await screen.findByRole('button', {
        name: /common\.operation\.downloading.*report\.md/i,
      }),
    ).toBeInTheDocument()

    download.reject(new Error('download failed'))

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /common\.operation\.download.*report\.md/i,
        }),
      ).toBeInTheDocument()
    })
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('should clear workflow download pending state without reporting success after failure', async () => {
    const user = userEvent.setup()
    const download = createDeferred<{ url: string }>()
    mocks.workflowSandboxFileDownloadMutationFn.mockReturnValueOnce(download.promise)
    renderWorkflowWorkingDirectoryPanel()

    await user.click(
      await screen.findByRole('button', {
        name: /common\.operation\.download.*chart\.png/i,
      }),
    )
    expect(
      await screen.findByRole('button', {
        name: /common\.operation\.downloading.*chart\.png/i,
      }),
    ).toBeInTheDocument()

    download.reject(new Error('download failed'))

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: /common\.operation\.download.*chart\.png/i,
        }),
      ).toBeInTheDocument()
    })
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })
})
