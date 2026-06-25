import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useAtomValue } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentDriveApiContextProvider } from '../../drive-context'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentFiles } from '../index'

const mocks = vi.hoisted(() => ({
  agentDriveFilesQueryOptions: vi.fn(),
  agentFileCommitMutationFn: vi.fn(),
  agentFileDeleteMutationFn: vi.fn(),
  agentFileDeleteMutationOptions: vi.fn(),
  agentFileDownloadQueryOptions: vi.fn(),
  agentFilePreviewQueryOptions: vi.fn(),
  agentFileCommitMutationOptions: vi.fn(),
  workflowAgentDriveFilesQueryOptions: vi.fn(),
  workflowAgentFileCommitMutationFn: vi.fn(),
  workflowAgentFileDeleteMutationFn: vi.fn(),
  workflowAgentFileDeleteMutationOptions: vi.fn(),
  workflowAgentFileDownloadQueryOptions: vi.fn(),
  workflowAgentFilePreviewQueryOptions: vi.fn(),
  workflowAgentFileCommitMutationOptions: vi.fn(),
  uploadFileMutationFn: vi.fn(),
  uploadFileMutationOptions: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    agent: {
      byAgentId: {
        drive: {
          files: {
            get: {
              queryOptions: mocks.agentDriveFilesQueryOptions,
            },
            download: {
              get: {
                queryOptions: mocks.agentFileDownloadQueryOptions,
              },
            },
            preview: {
              get: {
                queryOptions: mocks.agentFilePreviewQueryOptions,
              },
            },
          },
        },
        files: {
          delete: {
            mutationOptions: mocks.agentFileDeleteMutationOptions,
          },
          post: {
            mutationOptions: mocks.agentFileCommitMutationOptions,
          },
        },
      },
    },
    apps: {
      byAppId: {
        agent: {
          drive: {
            files: {
              get: {
                queryOptions: mocks.workflowAgentDriveFilesQueryOptions,
              },
              download: {
                get: {
                  queryOptions: mocks.workflowAgentFileDownloadQueryOptions,
                },
              },
              preview: {
                get: {
                  queryOptions: mocks.workflowAgentFilePreviewQueryOptions,
                },
              },
            },
          },
          files: {
            delete: {
              mutationOptions: mocks.workflowAgentFileDeleteMutationOptions,
            },
            post: {
              mutationOptions: mocks.workflowAgentFileCommitMutationOptions,
            },
          },
        },
      },
    },
    files: {
      upload: {
        post: {
          mutationOptions: mocks.uploadFileMutationOptions,
        },
      },
    },
  },
}))

const agentFilesDraft = {
  ...defaultAgentSoulConfigFormState,
  files: [
    {
      id: 'files/agent-roster-skill-detail-dialog-preview-image.png',
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
      icon: 'image',
      driveKey: 'files/agent-roster-skill-detail-dialog-preview-image.png',
    },
    {
      id: 'files/brief.md',
      name: 'brief.md',
      icon: 'markdown',
      driveKey: 'files/brief.md',
    },
  ],
} satisfies AgentSoulConfigFormState

const agentSkillFilesDraft = {
  ...defaultAgentSoulConfigFormState,
  files: [
    {
      id: 'files/run.py',
      name: 'run.py',
      icon: 'code',
      driveKey: 'files/run.py',
    },
    {
      id: 'files/SKILL.md',
      name: 'SKILL.md',
      icon: 'markdown',
      driveKey: 'files/SKILL.md',
    },
  ],
} satisfies AgentSoulConfigFormState

function renderAgentFiles(initialDraft: AgentSoulConfigFormState = agentFilesDraft) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentDriveApiContextProvider value={{ agentId: 'agent-1' }}>
        <AgentComposerProvider initialDraft={initialDraft}>
          <AgentFiles />
        </AgentComposerProvider>
      </AgentDriveApiContextProvider>
    </QueryClientProvider>,
  )
}

function renderReadonlyAgentFiles() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentDriveApiContextProvider value={{ agentId: 'agent-1' }}>
        <AgentComposerProvider initialDraft={agentFilesDraft}>
          <AgentOrchestrateReadOnlyContext value>
            <AgentFiles />
          </AgentOrchestrateReadOnlyContext>
        </AgentComposerProvider>
      </AgentDriveApiContextProvider>
    </QueryClientProvider>,
  )
}

function renderWorkflowAgentFiles(initialDraft: AgentSoulConfigFormState = agentFilesDraft) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentDriveApiContextProvider value={{ agentId: 'agent-1', workflow: { appId: 'app-1', nodeId: 'node-1' } }}>
        <AgentComposerProvider initialDraft={initialDraft}>
          <AgentFiles />
        </AgentComposerProvider>
      </AgentDriveApiContextProvider>
    </QueryClientProvider>,
  )
}

function ConfigSnapshotProbe() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const configSnapshot = formStateToAgentSoulConfig({ formState: draft })

  return (
    <pre data-testid="config-snapshot-probe">
      {JSON.stringify(configSnapshot)}
    </pre>
  )
}

describe('AgentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const baseItems = [
      {
        file_kind: 'file',
        key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
        mime_type: 'image/png',
      },
      {
        file_kind: 'file',
        key: 'files/brief.md',
        mime_type: 'text/markdown',
      },
    ]
    mocks.agentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      initialData: { items: baseItems },
      queryFn: async () => ({
        items: baseItems,
      }),
    }))
    mocks.workflowAgentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-drive-files', input],
      initialData: { items: baseItems },
      queryFn: async () => ({
        items: baseItems,
      }),
    }))
    mocks.agentFilePreviewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-file-preview', input],
      queryFn: async () => ({
        binary: false,
        text: `Preview content for ${input.query.key}`,
      }),
    }))
    mocks.workflowAgentFilePreviewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-file-preview', input],
      queryFn: async () => ({
        binary: false,
        text: `Preview content for ${input.query.key}`,
      }),
    }))
    mocks.agentFileDownloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-file-download', input],
      queryFn: async () => ({
        url: `https://signed.example/${input.query.key}`,
      }),
    }))
    mocks.workflowAgentFileDownloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-file-download', input],
      queryFn: async () => ({
        url: `https://signed.example/${input.query.key}`,
      }),
    }))
    mocks.uploadFileMutationOptions.mockReturnValue({
      mutationFn: mocks.uploadFileMutationFn.mockResolvedValue({
        id: 'upload-file-1',
        name: 'uploaded.md',
        mime_type: 'text/markdown',
      }),
      mutationKey: ['upload-file'],
    })
    mocks.agentFileCommitMutationOptions.mockReturnValue({
      mutationFn: mocks.agentFileCommitMutationFn.mockResolvedValue({
        file: {
          drive_key: 'files/uploaded.md',
          file_id: 'drive-file-1',
          mime_type: 'text/markdown',
          name: 'uploaded.md',
        },
      }),
      mutationKey: ['commit-agent-file'],
    })
    mocks.workflowAgentFileCommitMutationOptions.mockReturnValue({
      mutationFn: mocks.workflowAgentFileCommitMutationFn.mockResolvedValue({
        file: {
          drive_key: 'files/uploaded.md',
          file_id: 'drive-file-1',
          mime_type: 'text/markdown',
          name: 'uploaded.md',
        },
      }),
      mutationKey: ['commit-workflow-agent-file'],
    })
    mocks.agentFileDeleteMutationOptions.mockReturnValue({
      mutationFn: mocks.agentFileDeleteMutationFn.mockResolvedValue({ result: 'success' }),
      mutationKey: ['delete-agent-file'],
    })
    mocks.workflowAgentFileDeleteMutationOptions.mockReturnValue({
      mutationFn: mocks.workflowAgentFileDeleteMutationFn.mockResolvedValue({ result: 'success' }),
      mutationKey: ['delete-workflow-agent-file'],
    })
  })

  it('should list Agent Soul files under the files prefix', () => {
    renderAgentFiles()

    expect(screen.getByRole('button', { name: 'brief.md' })).toBeInTheDocument()
    expect(mocks.agentDriveFilesQueryOptions).not.toHaveBeenCalled()
  })

  it('should list workflow-node Agent Soul files under the files prefix', () => {
    renderWorkflowAgentFiles()

    expect(screen.getByRole('button', { name: 'brief.md' })).toBeInTheDocument()
    expect(mocks.workflowAgentDriveFilesQueryOptions).not.toHaveBeenCalled()
  })

  it('should keep the file preview trigger focus ring inside the row bounds', () => {
    renderAgentFiles()

    expect(screen.getByRole('button', { name: 'brief.md' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-state-accent-solid',
      'focus-visible:ring-inset',
    )
  })

  it('should open the shared detail dialog with the full file tree when the file row is clicked', async () => {
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: 'brief.md',
    }))

    const dialog = screen.getByRole('dialog')

    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('agent-roster-skill-detail-dialog-preview-image.png')).toBeInTheDocument()
    expect(within(dialog).getAllByText('brief.md')).toHaveLength(2)
    expect(mocks.agentFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'files/brief.md',
        },
      },
    })
    expect(await within(dialog).findByText('Preview content for files/brief.md')).toBeInTheDocument()
  })

  it('should preview the clicked file when SKILL.md also exists', async () => {
    mocks.agentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      initialData: {
        items: [
          { file_kind: 'file', key: 'files/run.py', mime_type: 'text/x-python' },
          { file_kind: 'file', key: 'files/SKILL.md', mime_type: 'text/markdown' },
        ],
      },
      queryFn: async () => ({
        items: [
          { file_kind: 'file', key: 'files/run.py', mime_type: 'text/x-python' },
          { file_kind: 'file', key: 'files/SKILL.md', mime_type: 'text/markdown' },
        ],
      }),
    }))
    renderAgentFiles(agentSkillFilesDraft)

    fireEvent.click(screen.getByRole('button', {
      name: 'run.py',
    }))

    const dialog = screen.getByRole('dialog')

    expect(await within(dialog).findByText('Preview content for files/run.py')).toBeInTheDocument()
    expect(mocks.agentFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'files/run.py',
        },
      },
    })
  })

  it('should preview the selected file from the detail file tree', async () => {
    mocks.agentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      initialData: {
        items: [
          { file_kind: 'file', key: 'files/run.py', mime_type: 'text/x-python' },
          { file_kind: 'file', key: 'files/SKILL.md', mime_type: 'text/markdown' },
        ],
      },
      queryFn: async () => ({
        items: [
          { file_kind: 'file', key: 'files/run.py', mime_type: 'text/x-python' },
          { file_kind: 'file', key: 'files/SKILL.md', mime_type: 'text/markdown' },
        ],
      }),
    }))
    renderAgentFiles(agentSkillFilesDraft)

    fireEvent.click(screen.getByRole('button', {
      name: 'run.py',
    }))

    const dialog = screen.getByRole('dialog')
    const skillFile = within(dialog).getByRole('button', { name: 'SKILL.md' })
    fireEvent.click(skillFile)

    expect(await within(dialog).findByText('Preview content for files/SKILL.md')).toBeInTheDocument()

    const scriptFile = within(dialog).getAllByRole('button', { name: 'run.py' }).at(-1)
    expect(scriptFile).toBeDefined()
    fireEvent.click(scriptFile!)

    expect(await within(dialog).findByText('Preview content for files/run.py')).toBeInTheDocument()
    expect(mocks.agentFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'files/run.py',
        },
      },
    })
  })

  it('should render image files directly from the drive download URL without a download link', async () => {
    mocks.agentFilePreviewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-file-preview', input],
      queryFn: async () => ({
        binary: false,
        key: input.query.key,
        size: 12345,
        text: 'image preview should not render as text',
        truncated: false,
      }),
    }))
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
    }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mocks.agentFileDownloadQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
        },
      },
    })
  })

  it('should render a download link for binary non-image files', async () => {
    mocks.agentFilePreviewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-file-preview', input],
      queryFn: async () => ({
        binary: true,
        key: input.query.key,
        size: 12345,
        text: null,
        truncated: false,
      }),
    }))
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: 'brief.md',
    }))

    const link = await screen.findByRole('link', { name: 'common.operation.download' })

    expect(screen.getByText('agentV2.agentDetail.configure.files.preview.unsupported')).toBeInTheDocument()
    expect(link).toHaveAttribute('href', 'https://signed.example/files/brief.md')
    expect(screen.queryByText('Preview content for files/brief.md')).not.toBeInTheDocument()
  })

  it('should use workflow preview and download routes when workflow context is active', async () => {
    mocks.workflowAgentFilePreviewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-file-preview', input],
      queryFn: async () => ({
        binary: true,
        key: input.query.key,
        size: 12345,
        text: null,
        truncated: false,
      }),
    }))
    renderWorkflowAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: 'brief.md',
    }))

    expect(mocks.workflowAgentFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
        },
        query: {
          node_id: 'node-1',
          key: 'files/brief.md',
        },
      },
    })
    expect(mocks.workflowAgentFileDownloadQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
        },
        query: {
          node_id: 'node-1',
          key: 'files/brief.md',
        },
      },
    })
    expect(await screen.findByRole('link', { name: 'common.operation.download' })).toHaveAttribute(
      'href',
      'https://signed.example/files/brief.md',
    )
  })

  it('should commit an uploaded file to the Agent App drive before adding it to the composer draft', async () => {
    const driveFiles = [
      {
        file_kind: 'file',
        key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
        mime_type: 'image/png',
      },
      {
        file_kind: 'file',
        key: 'files/brief.md',
        mime_type: 'text/markdown',
      },
    ]
    mocks.agentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      initialData: { items: [...driveFiles] },
      queryFn: async () => ({ items: [...driveFiles] }),
    }))
    mocks.agentFileCommitMutationOptions.mockReturnValue({
      mutationFn: mocks.agentFileCommitMutationFn.mockImplementation(async () => {
        driveFiles.push({
          file_kind: 'file',
          key: 'files/uploaded.md',
          mime_type: 'text/markdown',
        })
        return {
          file: {
            drive_key: 'files/uploaded.md',
            file_id: 'drive-file-1',
            mime_type: 'text/markdown',
            name: 'uploaded.md',
          },
        }
      }),
      mutationKey: ['commit-agent-file'],
    })
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <AgentDriveApiContextProvider value={{ agentId: 'agent-1' }}>
          <AgentComposerProvider initialDraft={defaultAgentSoulConfigFormState}>
            <AgentFiles />
            <ConfigSnapshotProbe />
          </AgentComposerProvider>
        </AgentDriveApiContextProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.files.add' }))
    const input = document.querySelector('input[type="file"]')
    expect(input).toBeInstanceOf(HTMLInputElement)

    fireEvent.change(input!, {
      target: {
        files: [new File(['# Uploaded'], 'uploaded.md', { type: 'text/markdown' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.files.upload.action' }))

    await waitFor(() => {
      expect(mocks.agentFileCommitMutationFn).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
          body: {
            upload_file_id: 'upload-file-1',
          },
        },
        expect.anything(),
      )
    })
    expect(await screen.findByRole('button', { name: 'uploaded.md' })).toBeInTheDocument()
    await waitFor(() => {
      const serializedConfig = JSON.parse(screen.getByTestId('config-snapshot-probe').textContent ?? '{}')
      expect(serializedConfig.files.files).toEqual([
        {
          id: 'drive-file-1',
          file_id: 'drive-file-1',
          name: 'uploaded.md',
          drive_key: 'files/uploaded.md',
        },
      ])
    })
  })

  it('should commit an uploaded file through workflow-node drive endpoints and refresh the list', async () => {
    const driveFiles = [
      {
        file_kind: 'file',
        key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
        mime_type: 'image/png',
      },
      {
        file_kind: 'file',
        key: 'files/brief.md',
        mime_type: 'text/markdown',
      },
    ]
    mocks.workflowAgentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-drive-files', input],
      initialData: { items: [...driveFiles] },
      queryFn: async () => ({ items: [...driveFiles] }),
    }))
    mocks.workflowAgentFileCommitMutationOptions.mockReturnValue({
      mutationFn: mocks.workflowAgentFileCommitMutationFn.mockImplementation(async () => {
        driveFiles.push({
          file_kind: 'file',
          key: 'files/uploaded.md',
          mime_type: 'text/markdown',
        })
        return {
          file: {
            drive_key: 'files/uploaded.md',
            file_id: 'drive-file-1',
            mime_type: 'text/markdown',
            name: 'uploaded.md',
          },
        }
      }),
      mutationKey: ['commit-workflow-agent-file'],
    })
    renderWorkflowAgentFiles({
      ...defaultAgentSoulConfigFormState,
    })

    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.files.add' }))
    const input = document.querySelector('input[type="file"]')
    expect(input).toBeInstanceOf(HTMLInputElement)

    fireEvent.change(input!, {
      target: {
        files: [new File(['# Uploaded'], 'uploaded.md', { type: 'text/markdown' })],
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.files.upload.action' }))

    await waitFor(() => {
      expect(mocks.workflowAgentFileCommitMutationFn).toHaveBeenCalledWith(
        {
          params: {
            app_id: 'app-1',
          },
          query: {
            node_id: 'node-1',
          },
          body: {
            upload_file_id: 'upload-file-1',
          },
        },
        expect.anything(),
      )
    })
    expect(await screen.findByRole('button', { name: 'uploaded.md' })).toBeInTheDocument()
  })

  // File rows expose a hover/focus remove action that updates the composer draft.
  it('should delete the file when the remove action is clicked', async () => {
    const driveFiles = [
      {
        file_kind: 'file',
        key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
        mime_type: 'image/png',
      },
      {
        file_kind: 'file',
        key: 'files/brief.md',
        mime_type: 'text/markdown',
      },
    ]
    mocks.agentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      initialData: { items: [...driveFiles] },
      queryFn: async () => ({ items: [...driveFiles] }),
    }))
    mocks.agentFileDeleteMutationOptions.mockReturnValue({
      mutationFn: mocks.agentFileDeleteMutationFn.mockImplementation(async () => {
        driveFiles.splice(0, 1)
        return { result: 'success' }
      }),
      mutationKey: ['delete-agent-file'],
    })
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    }))

    await waitFor(() => {
      expect(mocks.agentFileDeleteMutationFn).toHaveBeenCalledWith(
        {
          params: {
            agent_id: 'agent-1',
          },
          query: {
            key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
          },
        },
        expect.anything(),
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'agent-roster-skill-detail-dialog-preview-image.png' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'brief.md' })).toBeInTheDocument()
  })

  it('should delete a workflow-node file through workflow endpoints and refresh the list', async () => {
    const driveFiles = [
      {
        file_kind: 'file',
        key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
        mime_type: 'image/png',
      },
      {
        file_kind: 'file',
        key: 'files/brief.md',
        mime_type: 'text/markdown',
      },
    ]
    mocks.workflowAgentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-drive-files', input],
      initialData: { items: [...driveFiles] },
      queryFn: async () => ({ items: [...driveFiles] }),
    }))
    mocks.workflowAgentFileDeleteMutationOptions.mockReturnValue({
      mutationFn: mocks.workflowAgentFileDeleteMutationFn.mockImplementation(async () => {
        driveFiles.splice(0, 1)
        return { result: 'success' }
      }),
      mutationKey: ['delete-workflow-agent-file'],
    })
    renderWorkflowAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    }))

    await waitFor(() => {
      expect(mocks.workflowAgentFileDeleteMutationFn).toHaveBeenCalledWith(
        {
          params: {
            app_id: 'app-1',
          },
          query: {
            node_id: 'node-1',
            key: 'files/agent-roster-skill-detail-dialog-preview-image.png',
          },
        },
        expect.anything(),
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'agent-roster-skill-detail-dialog-preview-image.png' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'brief.md' })).toBeInTheDocument()
  })

  it('should render the empty state when Agent Soul has no files', () => {
    renderAgentFiles({
      ...defaultAgentSoulConfigFormState,
    })

    expect(screen.getByText('agentV2.agentDetail.configure.files.empty.title')).toBeInTheDocument()
  })

  it('should hide add and remove actions when readonly', () => {
    renderReadonlyAgentFiles()

    expect(screen.getByRole('button', {
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
    })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.files.add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    })).not.toBeInTheDocument()
  })
})
