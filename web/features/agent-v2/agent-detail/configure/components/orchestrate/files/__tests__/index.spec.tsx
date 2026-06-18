import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
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
      id: 'preview-image',
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
      icon: 'image',
      driveKey: 'files/agent-roster-skill-detail-dialog-preview-image.png',
    },
    {
      id: 'brief',
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
      id: 'script',
      name: 'run.py',
      icon: 'file',
      driveKey: 'files/run.py',
    },
    {
      id: 'skill-md',
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
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentFiles agentId="agent-1" />
      </AgentComposerProvider>
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
      <AgentComposerProvider initialDraft={agentFilesDraft}>
        <AgentOrchestrateReadOnlyContext value>
          <AgentFiles agentId="agent-1" />
        </AgentOrchestrateReadOnlyContext>
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

describe('AgentFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.agentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      queryFn: () => new Promise(() => {}),
    }))
    mocks.workflowAgentDriveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['workflow-agent-drive-files', input],
      queryFn: () => new Promise(() => {}),
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

  it('should list Agent App drive files under the files prefix', () => {
    renderAgentFiles()

    expect(mocks.agentDriveFilesQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          prefix: 'files/',
        },
      },
    })
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

    const image = await screen.findByRole('img', {
      name: 'agent-roster-skill-detail-dialog-preview-image.png',
    })

    expect(image).toHaveAttribute('src', 'https://signed.example/files/agent-roster-skill-detail-dialog-preview-image.png')
    expect(screen.queryByRole('link', { name: /common\.operation\.download/ })).not.toBeInTheDocument()
    expect(screen.queryByText('image preview should not render as text')).not.toBeInTheDocument()
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

  it('should commit an uploaded file to the Agent App drive before adding it to the composer draft', async () => {
    renderAgentFiles({
      ...defaultAgentSoulConfigFormState,
      files: [],
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
  })

  // File rows expose a hover/focus remove action that updates the composer draft.
  it('should remove the file from the list when the remove action is clicked', () => {
    renderAgentFiles()

    expect(screen.getByText('agent-roster-skill-detail-dialog-preview-image.png')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    }))

    expect(screen.queryByText('agent-roster-skill-detail-dialog-preview-image.png')).not.toBeInTheDocument()
    expect(screen.getByText('brief.md')).toBeInTheDocument()
  })

  it('should render the empty state after removing every file', () => {
    renderAgentFiles()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*agent-roster-skill-detail-dialog-preview-image\.png/,
    }))
    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.files\.remove.*brief\.md/,
    }))

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
