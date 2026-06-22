import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useAgentComposerConfigSnapshot } from '@/features/agent-v2/agent-composer/store'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentSkills } from '../index'

const mocks = vi.hoisted(() => ({
  driveFilesQueryOptions: vi.fn(),
  driveFileDownloadQueryOptions: vi.fn(),
  driveFilePreviewQueryOptions: vi.fn(),
  uploadSkillMutationOptions: vi.fn(),
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
        drive: {
          files: {
            get: {
              queryOptions: mocks.driveFilesQueryOptions,
            },
            download: {
              get: {
                queryOptions: mocks.driveFileDownloadQueryOptions,
              },
            },
            preview: {
              get: {
                queryOptions: mocks.driveFilePreviewQueryOptions,
              },
            },
          },
        },
        skills: {
          upload: {
            post: {
              mutationOptions: mocks.uploadSkillMutationOptions,
            },
          },
        },
      },
    },
  },
}))

const agentSkillsDraft = {
  ...defaultAgentSoulConfigFormState,
  skills: [
    {
      id: 'tender-analyzer',
      name: 'Tender Analyzer',
      description: 'Extracts tender requirements and scoring criteria.',
      files: ['__MACOSX/._hatch-pet', 'SKILL.md', 'schema.json'],
      path: 'tender-analyzer',
      skillMdKey: 'tender-analyzer/SKILL.md',
    },
    {
      id: 'meeting-brief',
      name: 'Meeting Brief',
      path: 'meeting-brief',
    },
  ],
} satisfies typeof defaultAgentSoulConfigFormState

function renderAgentSkills() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={agentSkillsDraft}>
        <AgentSkills agentId="agent-1" />
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

function renderReadonlyAgentSkills() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={agentSkillsDraft}>
        <AgentOrchestrateReadOnlyContext value>
          <AgentSkills agentId="agent-1" />
        </AgentOrchestrateReadOnlyContext>
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

function ConfigSnapshotProbe() {
  const configSnapshot = useAgentComposerConfigSnapshot({})

  return (
    <pre data-testid="config-snapshot-probe">
      {JSON.stringify(configSnapshot.skills_files?.skills ?? [])}
    </pre>
  )
}

describe('AgentSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.driveFilesQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-files', input],
      queryFn: async () => ({
        items: [
          {
            file_kind: 'file',
            key: 'tender-analyzer/SKILL.md',
          },
          {
            file_kind: 'file',
            key: 'tender-analyzer/scripts/extract.py',
          },
        ],
      }),
    }))
    mocks.driveFilePreviewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-file-preview', input],
      queryFn: async () => ({
        text: `Preview content for ${input.query.key}`,
      }),
    }))
    mocks.driveFileDownloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-file-download', input],
      queryFn: async () => ({
        url: `https://example.com/${input.query.key}`,
      }),
    }))
    mocks.uploadSkillMutationOptions.mockReturnValue({
      mutationFn: vi.fn(),
      mutationKey: ['upload-skill'],
    })
  })

  // Skill rows load their preview from the agent drive and render the shared detail dialog.
  it('should fetch drive files and open the skill detail dialog when the skill row is clicked', async () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    const dialog = screen.getByRole('dialog')

    expect(dialog).toBeInTheDocument()
    expect(mocks.driveFilesQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          prefix: 'tender-analyzer/',
        },
      },
    })
    expect(within(dialog).getByText('Tender Analyzer')).toBeInTheDocument()
    expect(within(dialog).getByText('Extracts tender requirements and scoring criteria.')).toBeInTheDocument()
    expect(within(dialog).queryByText('__MACOSX/._hatch-pet')).not.toBeInTheDocument()
    expect(await within(dialog).findByText('scripts/extract.py')).toBeInTheDocument()
    expect(within(dialog).getByText('SKILL.md')).toBeInTheDocument()
    expect(await within(dialog).findByText('Preview content for tender-analyzer/SKILL.md')).toBeInTheDocument()
    expect(mocks.driveFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'tender-analyzer/SKILL.md',
        },
      },
    })
    expect(mocks.driveFilePreviewQueryOptions).not.toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'tender-analyzer/__MACOSX/._hatch-pet',
        },
      },
    })
  })

  it('should preview the selected skill file from the detail file tree', async () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    const dialog = screen.getByRole('dialog')
    const scriptFile = await within(dialog).findByRole('button', { name: 'scripts/extract.py' })
    fireEvent.click(scriptFile)

    expect(await within(dialog).findByText('Preview content for tender-analyzer/scripts/extract.py')).toBeInTheDocument()
    expect(mocks.driveFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'tender-analyzer/scripts/extract.py',
        },
      },
    })
  })

  // The hover/focus remove action updates the composer draft without opening preview.
  it('should remove the skill without opening the detail dialog when the remove action is clicked', () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    expect(screen.queryByText('Tender Analyzer')).not.toBeInTheDocument()
    expect(screen.getByText('Meeting Brief')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should hide add and remove actions when readonly', () => {
    renderReadonlyAgentSkills()

    expect(screen.getByRole('button', { name: 'Tender Analyzer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    })).not.toBeInTheDocument()
  })

  // Upload uses the drive-backed response so the added skill can be reloaded from agent drive paths.
  it('should add an uploaded skill with drive-backed keys when the upload succeeds', async () => {
    const user = userEvent.setup()
    const uploadSkill = vi.fn().mockResolvedValue({
      manifest: {
        files: ['SKILL.md', 'scripts/run.py'],
        name: 'Invoice Helper',
      },
      skill: {
        id: 'skill-hash',
        manifest_files: ['SKILL.md', 'scripts/run.py'],
        name: 'Invoice Helper',
        path: 'invoice-helper',
        skill_md_key: 'invoice-helper/SKILL.md',
      },
    })
    mocks.uploadSkillMutationOptions.mockReturnValue({
      mutationFn: uploadSkill,
      mutationKey: ['upload-skill'],
    })

    renderAgentSkills()

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.upload.action' }))

    await waitFor(() => {
      expect(uploadSkill.mock.calls[0]?.[0]).toEqual({
        body: {
          file,
        },
        params: {
          agent_id: 'agent-1',
        },
      })
    })
    expect(await screen.findByRole('button', { name: 'Invoice Helper' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Invoice Helper' }))

    expect(mocks.driveFilesQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          prefix: 'invoice-helper/',
        },
      },
    })
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('agentV2.agentDetail.configure.skills.upload.success')
  })

  // Uploaded drive-backed refs must survive insertion into draft and serialization back to config.
  it('should preserve archive and skill file ids from the upload response in the serialized draft', async () => {
    const user = userEvent.setup()
    const uploadSkill = vi.fn().mockResolvedValue({
      manifest: {
        files: ['SKILL.md', 'scripts/run.py'],
        name: 'Invoice Helper',
      },
      skill: {
        file_id: 'archive-upload-file-id',
        full_archive_file_id: 'archive-tool-file-id',
        full_archive_key: 'invoice-helper/.DIFY-SKILL-FULL.zip',
        id: 'skill-hash',
        manifest_files: ['SKILL.md', 'scripts/run.py'],
        name: 'Invoice Helper',
        path: 'invoice-helper',
        skill_md_file_id: 'skill-md-tool-file-id',
        skill_md_key: 'invoice-helper/SKILL.md',
      },
    })
    mocks.uploadSkillMutationOptions.mockReturnValue({
      mutationFn: uploadSkill,
      mutationKey: ['upload-skill'],
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
        <AgentComposerProvider initialDraft={agentSkillsDraft}>
          <AgentSkills agentId="agent-1" />
          <ConfigSnapshotProbe />
        </AgentComposerProvider>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.upload.action' }))

    await waitFor(() => {
      const serializedSkills = JSON.parse(screen.getByTestId('config-snapshot-probe').textContent ?? '[]')
      expect(serializedSkills).toEqual(expect.arrayContaining([
        expect.objectContaining({
          file_id: 'archive-upload-file-id',
          full_archive_file_id: 'archive-tool-file-id',
          full_archive_key: 'invoice-helper/.DIFY-SKILL-FULL.zip',
          name: 'Invoice Helper',
          path: 'invoice-helper',
          skill_md_file_id: 'skill-md-tool-file-id',
          skill_md_key: 'invoice-helper/SKILL.md',
        }),
      ]))
    })
  })
})
