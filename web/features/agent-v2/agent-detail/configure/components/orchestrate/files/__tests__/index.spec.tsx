import type { AgentSoulConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentConfigApiContext } from '../../config-context'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  deleteFileMutationFn: vi.fn(async (_input: unknown) => ({
    removed_names: ['brief.md'],
    result: 'success',
  })),
  previewQueryOptions: vi.fn((_options: ConfigFileQueryOptionsInput) => ({})),
  downloadQueryOptions: vi.fn((_options: ConfigFileQueryOptionsInput) => ({})),
  downloadBlob: vi.fn(),
  downloadUrl: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
  downloadUrl: mocks.downloadUrl,
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

  return <pre data-testid="config-snapshot-probe">{JSON.stringify(configSnapshot)}</pre>
}

function createInitialDraft(
  overrides: Partial<AgentSoulConfigFormState> = {},
): AgentSoulConfigFormState {
  return {
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
    ...overrides,
  }
}

function renderAgentFiles({
  initialDraft = createInitialDraft(),
  initialOriginalConfig,
  apiContext = { agentId: 'agent-1', draftType: 'draft' } satisfies AgentConfigApiContext,
  readOnly = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  initialOriginalConfig?: AgentSoulConfig
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
        <AgentComposerProvider
          initialDraft={initialDraft}
          initialOriginalConfig={initialOriginalConfig}
        >
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

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.files\.add/i }),
    )

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['hello'], 'uploaded.md', { type: 'text/markdown' })
    await user.upload(input, file)
    await user.click(
      screen.getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/i }),
    )

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

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.files\.add/i }),
    )

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['hello'], 'uploaded.md', { type: 'text/markdown' })
    await user.upload(input, file)
    await user.click(
      screen.getByRole('button', { name: /agentDetail\.configure\.files\.upload\.action/i }),
    )

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
      expect(mocks.previewQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
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
        }),
      )
    })
  })

  it('should preview and download files through config file endpoints by name', async () => {
    const user = userEvent.setup()
    renderAgentFiles()

    await user.click(screen.getByText('diagram.png').closest('button')!)

    await waitFor(() => {
      expect(mocks.previewQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'diagram.png',
            },
          }),
        }),
      )
    })

    await waitFor(() => {
      expect(mocks.downloadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'diagram.png',
            },
          }),
        }),
      )
    })
  })

  it('should download configured files from the row action by config name', async () => {
    const user = userEvent.setup()
    renderAgentFiles()

    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.files\.download.*diagram\.png/,
      }),
    )

    await waitFor(() => {
      expect(mocks.downloadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'diagram.png',
            },
          }),
        }),
      )
    })
    expect(mocks.downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/diagram.png',
      fileName: 'diagram.png',
    })
  })

  it('should download the selected file from the preview header action', async () => {
    const user = userEvent.setup()
    renderAgentFiles()

    await user.click(screen.getByText('diagram.png').closest('button')!)
    const dialog = await screen.findByRole('dialog')

    await user.click(
      within(dialog).getByRole('button', {
        name: /common\.operation\.download.*diagram\.png/,
      }),
    )

    await waitFor(() => {
      expect(mocks.downloadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'diagram.png',
            },
          }),
        }),
      )
    })
    expect(mocks.downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/diagram.png',
      fileName: 'diagram.png',
    })
  })

  it('should show config note as a virtual build note file and preview its content locally', async () => {
    const user = userEvent.setup()
    renderAgentFiles({
      initialDraft: createInitialDraft({ configNote: 'Build context from the latest build chat.' }),
    })

    expect(screen.getByText('build_note.md')).toBeInTheDocument()
    const fileNames = screen
      .getAllByText(/^(build_note\.md|diagram\.png|brief\.md)$/)
      .map((element) => element.textContent)
    expect(fileNames).toEqual(['build_note.md', 'diagram.png', 'brief.md'])

    vi.clearAllMocks()

    await user.click(screen.getByText('build_note.md').closest('button')!)

    expect(await screen.findByText('Build context from the latest build chat.')).toBeInTheDocument()
    expect(mocks.previewQueryOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          params: expect.objectContaining({
            name: 'build_note.md',
          }),
        }),
      }),
    )
    expect(mocks.downloadQueryOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          params: expect.objectContaining({
            name: 'build_note.md',
          }),
        }),
      }),
    )
  })

  it('should download the virtual build note file as markdown content', async () => {
    const user = userEvent.setup()
    renderAgentFiles({
      initialDraft: createInitialDraft({ configNote: 'Build context from the latest build chat.' }),
    })

    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.files\.download.*build_note\.md/,
      }),
    )

    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'build_note.md',
    })
    const blob = mocks.downloadBlob.mock.calls[0]?.[0].data as Blob
    await expect(blob.text()).resolves.toBe('Build context from the latest build chat.')
    expect(mocks.downloadQueryOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          params: expect.objectContaining({
            name: 'build_note.md',
          }),
        }),
      }),
    )
  })

  it('should download the virtual build note from the preview header action', async () => {
    const user = userEvent.setup()
    renderAgentFiles({
      initialDraft: createInitialDraft({ configNote: 'Build context from the latest build chat.' }),
    })

    await user.click(screen.getByText('build_note.md').closest('button')!)
    const dialog = await screen.findByRole('dialog')

    await user.click(
      within(dialog).getByRole('button', {
        name: /common\.operation\.download.*build_note\.md/,
      }),
    )

    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'build_note.md',
    })
    const blob = mocks.downloadBlob.mock.calls[0]?.[0].data as Blob
    await expect(blob.text()).resolves.toBe('Build context from the latest build chat.')
  })

  it('should show generated build note metadata with an explanatory infotip', async () => {
    const user = userEvent.setup()
    renderAgentFiles({
      initialDraft: createInitialDraft({ configNote: 'Build context from the latest build chat.' }),
    })

    const generatedBadge = screen.getByText(
      'agentV2.agentDetail.configure.files.buildNote.generated',
    )
    const buildNoteRow = generatedBadge.closest('li')

    expect(generatedBadge).toBeInTheDocument()
    expect(buildNoteRow).not.toBeNull()

    await user.click(
      within(buildNoteRow!).getByRole('button', {
        name: 'agentV2.agentDetail.configure.files.buildNote.tooltip',
      }),
    )

    expect(
      await screen.findByText('agentV2.agentDetail.configure.files.buildNote.richTooltip'),
    ).toBeInTheDocument()
  })

  it('should clear config note when deleting the virtual build note file', async () => {
    const user = userEvent.setup()
    renderAgentFiles({
      initialDraft: createInitialDraft({ configNote: 'Build context from the latest build chat.' }),
    })

    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.files\.remove.*build_note\.md/,
      }),
    )

    expect(screen.queryByText('build_note.md')).not.toBeInTheDocument()
    expect(mocks.deleteFileMutationFn).not.toHaveBeenCalled()

    const snapshot = JSON.parse(screen.getByTestId('config-snapshot-probe').textContent ?? '{}')
    expect(snapshot.config_note).toBe('')
  })

  it('should keep flat config files visible without drive-prefix filtering and disable add in read-only mode', () => {
    renderAgentFiles({ readOnly: true })

    expect(screen.getByText('diagram.png')).toBeInTheDocument()
    expect(screen.getByText('brief.md')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /agentV2\.agentDetail\.configure\.files\.add/i }),
    ).not.toBeInTheDocument()
  })
})
