import type { AgentConfigApiContext } from '../../config-context'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentConfigApiContextProvider } from '../../config-context'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentFiles } from '../index'

type ConfigFileQueryOptionsInput = {
  input: {
    params: {
      name: string
    }
  }
}

const mocks = vi.hoisted(() => ({
  uploadFileMutationFn: vi.fn(async (_input: unknown) => ({ id: 'upload-1' })),
  commitFileMutationFn: vi.fn(async (_input: unknown) => ({
    config_version: { id: 'draft-1', kind: 'draft', writable: true },
    file: {
      id: 'uploaded.md',
      name: 'uploaded.md',
      file_id: 'drive-file-1',
      hash: 'sha256:file-1',
      mime_type: 'text/markdown',
      size: 5,
    },
  })),
  deleteFileMutationFn: vi.fn(async (_input: unknown) => ({ removed_names: ['brief.md'], result: 'success' })),
  previewQueryOptions: vi.fn((_options: ConfigFileQueryOptionsInput) => ({})),
  downloadQueryOptions: vi.fn((_options: ConfigFileQueryOptionsInput) => ({})),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        config: {
          files: {
            post: {
              mutationOptions: () => ({ mutationFn: mocks.commitFileMutationFn }),
            },
            byName: {
              delete: {
                mutationOptions: () => ({ mutationFn: mocks.deleteFileMutationFn }),
              },
              preview: {
                get: {
                  queryOptions: mocks.previewQueryOptions,
                },
              },
              download: {
                get: {
                  queryOptions: mocks.downloadQueryOptions,
                },
              },
            },
          },
        },
      },
    },
    apps: {
      byAppId: {
        agent: {
          config: {
            files: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.commitFileMutationFn }),
              },
              byName: {
                delete: {
                  mutationOptions: () => ({ mutationFn: mocks.deleteFileMutationFn }),
                },
                preview: {
                  get: {
                    queryOptions: mocks.previewQueryOptions,
                  },
                },
                download: {
                  get: {
                    queryOptions: mocks.downloadQueryOptions,
                  },
                },
              },
            },
          },
        },
      },
    },
    files: {
      upload: {
        post: {
          mutationOptions: () => ({ mutationFn: mocks.uploadFileMutationFn }),
        },
      },
    },
  },
}))

function ConfigSnapshotProbe() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const configSnapshot = formStateToAgentSoulConfig({ formState: draft })

  return (
    <pre data-testid="config-snapshot-probe">
      {JSON.stringify(configSnapshot)}
    </pre>
  )
}

function renderAgentFiles({
  initialDraft = {
    ...defaultAgentSoulConfigFormState,
    files: [
      {
        id: 'diagram.png',
        name: 'diagram.png',
        icon: 'image',
        fileId: 'upload-file-1',
        configName: 'diagram.png',
      },
      {
        id: 'brief.md',
        name: 'brief.md',
        icon: 'markdown',
        fileId: 'upload-file-2',
        configName: 'brief.md',
      },
    ],
  } satisfies AgentSoulConfigFormState,
  apiContext = { agentId: 'agent-1', draftType: 'draft' } satisfies AgentConfigApiContext,
  readOnly = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  apiContext?: AgentConfigApiContext
  readOnly?: boolean
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentConfigApiContextProvider value={apiContext}>
        <AgentComposerProvider initialDraft={initialDraft}>
          <AgentOrchestrateReadOnlyContext value={readOnly}>
            <AgentFiles />
            <ConfigSnapshotProbe />
          </AgentOrchestrateReadOnlyContext>
        </AgentComposerProvider>
      </AgentConfigApiContextProvider>
    </QueryClientProvider>,
  )
}

describe('AgentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.previewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['preview-config-file', input],
      queryFn: async () => ({
        name: input.params.name,
        binary: false,
        truncated: false,
        text: `Preview for ${input.params.name}`,
      }),
    }))
    mocks.downloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['download-config-file', input],
      queryFn: async () => ({
        url: `https://example.com/${input.params.name}`,
      }),
    }))
  })

  it('should delete configured files by config name', async () => {
    const { container } = renderAgentFiles()

    const removeButton = container.querySelector('[data-agent-file-remove-button]')
    expect(removeButton).not.toBeNull()

    fireEvent.click(removeButton!)

    await waitFor(() => {
      expect(mocks.deleteFileMutationFn).toHaveBeenCalled()
      expect(mocks.deleteFileMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
          name: 'diagram.png',
        },
        query: {
          draft_type: 'draft',
          version_id: undefined,
        },
      })
    })

    expect(screen.queryByText('diagram.png')).not.toBeInTheDocument()
  })

  it('should upload through the two-step config file flow and persist config_files in draft state', async () => {
    const user = userEvent.setup()
    renderAgentFiles({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.files\.add/i }))

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['hello'], 'uploaded.md', { type: 'text/markdown' })
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/i }))

    await waitFor(() => {
      expect(mocks.uploadFileMutationFn).toHaveBeenCalled()
      expect(mocks.uploadFileMutationFn.mock.calls[0]?.[0]).toEqual({
        body: {
          file,
        },
      })
    })

    await waitFor(() => {
      expect(mocks.commitFileMutationFn).toHaveBeenCalled()
      expect(mocks.commitFileMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        query: {
          draft_type: 'draft',
          version_id: undefined,
        },
        body: {
          upload_file_id: 'upload-1',
        },
      })
    })

    const snapshot = JSON.parse(screen.getByTestId('config-snapshot-probe').textContent ?? '{}')
    expect(snapshot.config_files).toEqual([
      expect.objectContaining({
        name: 'uploaded.md',
        file_id: 'drive-file-1',
        file_kind: 'upload_file',
        hash: 'sha256:file-1',
        mime_type: 'text/markdown',
        size: 5,
      }),
    ])
    expect(toast.success).toHaveBeenCalled()
  })

  it('should use workflow config file endpoints with node_id for preview and upload', async () => {
    const user = userEvent.setup()
    renderAgentFiles({
      apiContext: {
        agentId: 'agent-1',
        draftType: 'draft',
        versionId: 'draft-1',
        workflow: {
          appId: 'app-1',
          nodeId: 'node-1',
        },
      },
    })

    await user.click(screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.files\.add/i }))

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['hello'], 'uploaded.md', { type: 'text/markdown' })
    await user.upload(input, file)
    await user.click(screen.getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/i }))

    await waitFor(() => {
      expect(mocks.commitFileMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
        },
        query: {
          draft_type: 'draft',
          node_id: 'node-1',
          version_id: 'draft-1',
        },
        body: {
          upload_file_id: 'upload-1',
        },
      })
    })

    await user.click(screen.getByText('diagram.png').closest('button')!)

    await waitFor(() => {
      expect(mocks.previewQueryOptions).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          params: {
            app_id: 'app-1',
            name: 'diagram.png',
          },
          query: {
            draft_type: 'draft',
            node_id: 'node-1',
            version_id: 'draft-1',
          },
        }),
      }))
    })
  })

  it('should preview and download files through config file endpoints by name', async () => {
    const user = userEvent.setup()
    renderAgentFiles()

    await user.click(screen.getByText('diagram.png').closest('button')!)

    await waitFor(() => {
      expect(mocks.previewQueryOptions).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          params: {
            agent_id: 'agent-1',
            name: 'diagram.png',
          },
        }),
      }))
    })

    await waitFor(() => {
      expect(mocks.downloadQueryOptions).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({
          params: {
            agent_id: 'agent-1',
            name: 'diagram.png',
          },
        }),
      }))
    })
  })

  it('should keep flat config files visible without drive-prefix filtering and disable add in read-only mode', () => {
    renderAgentFiles({ readOnly: true })

    expect(screen.getByText('diagram.png')).toBeInTheDocument()
    expect(screen.getByText('brief.md')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agentV2\.agentDetail\.configure\.files\.add/i })).not.toBeInTheDocument()
  })
})
