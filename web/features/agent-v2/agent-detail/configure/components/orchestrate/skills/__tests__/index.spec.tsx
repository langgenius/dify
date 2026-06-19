import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { useAgentComposerConfigSnapshot } from '@/features/agent-v2/agent-composer/store'
import { AgentDriveApiContextProvider } from '../../drive-context'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentSkills } from '../index'

const mocks = vi.hoisted(() => ({
  driveSkillsQueryOptions: vi.fn(),
  driveFilesQueryOptions: vi.fn(),
  driveFileDownloadQueryOptions: vi.fn(),
  driveFilePreviewQueryOptions: vi.fn(),
  deleteSkillMutationOptions: vi.fn(),
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
          skills: {
            get: {
              queryOptions: mocks.driveSkillsQueryOptions,
            },
          },
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
          bySlug: {
            delete: {
              mutationOptions: mocks.deleteSkillMutationOptions,
            },
          },
          upload: {
            post: {
              mutationOptions: mocks.uploadSkillMutationOptions,
            },
          },
        },
      },
    },
    apps: {
      byAppId: {
        agent: {
          drive: {
            skills: {
              get: {
                queryOptions: mocks.driveSkillsQueryOptions,
              },
            },
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
            bySlug: {
              delete: {
                mutationOptions: mocks.deleteSkillMutationOptions,
              },
            },
            upload: {
              post: {
                mutationOptions: mocks.uploadSkillMutationOptions,
              },
            },
          },
        },
      },
    },
  },
}))

const agentSkillsDraft = {
  ...defaultAgentSoulConfigFormState,
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
      <AgentDriveApiContextProvider value={{ agentId: 'agent-1' }}>
        <AgentComposerProvider initialDraft={agentSkillsDraft}>
          <AgentSkills />
        </AgentComposerProvider>
      </AgentDriveApiContextProvider>
    </QueryClientProvider>,
  )
}

function renderWorkflowAgentSkills() {
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
        <AgentComposerProvider initialDraft={agentSkillsDraft}>
          <AgentSkills />
        </AgentComposerProvider>
      </AgentDriveApiContextProvider>
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
      <AgentDriveApiContextProvider value={{ agentId: 'agent-1' }}>
        <AgentComposerProvider initialDraft={agentSkillsDraft}>
          <AgentOrchestrateReadOnlyContext value>
            <AgentSkills />
          </AgentOrchestrateReadOnlyContext>
        </AgentComposerProvider>
      </AgentDriveApiContextProvider>
    </QueryClientProvider>,
  )
}

function ConfigSnapshotProbe() {
  const configSnapshot = useAgentComposerConfigSnapshot({})

  return (
    <pre data-testid="config-snapshot-probe">
      {JSON.stringify(configSnapshot)}
    </pre>
  )
}

describe('AgentSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const skillItems = [
      {
        archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        description: 'Extracts tender requirements and scoring criteria.',
        name: 'Tender Analyzer',
        path: 'tender-analyzer',
        skill_md_key: 'tender-analyzer/SKILL.md',
      },
      {
        description: '',
        name: 'Meeting Brief',
        path: 'meeting-brief',
        skill_md_key: 'meeting-brief/SKILL.md',
      },
    ]
    mocks.driveSkillsQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-skills', input],
      initialData: { items: skillItems },
      queryFn: async () => ({
        items: skillItems,
      }),
    }))
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
    mocks.deleteSkillMutationOptions.mockReturnValue({
      mutationFn: vi.fn(),
      mutationKey: ['delete-skill'],
    })
  })

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
  })

  it('should keep the detail dialog open after selecting a skill', async () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('should use workflow node drive routes for skill list and preview in inline workflow mode', async () => {
    renderWorkflowAgentSkills()

    expect(mocks.driveSkillsQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
        },
        query: {
          node_id: 'node-1',
        },
      },
    })

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    expect(mocks.driveFilesQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
        },
        query: {
          node_id: 'node-1',
          prefix: 'tender-analyzer/',
        },
      },
    })
    expect(mocks.driveFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          app_id: 'app-1',
        },
        query: {
          node_id: 'node-1',
          key: 'tender-analyzer/SKILL.md',
        },
      },
    })
  })

  it('should delete the skill without opening the detail dialog when the remove action is clicked', () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should route workflow skill delete through app and node identifiers', async () => {
    const deleteSkill = vi.fn().mockResolvedValue({ result: 'success', removed_keys: ['tender-analyzer/SKILL.md'] })
    mocks.deleteSkillMutationOptions.mockReturnValue({
      mutationFn: deleteSkill,
      mutationKey: ['delete-skill'],
    })
    renderWorkflowAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    await waitFor(() => {
      expect(deleteSkill.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
          slug: 'tender-analyzer',
        },
        query: {
          node_id: 'node-1',
        },
      })
    })
  })

  it('should hide add and remove actions when readonly', () => {
    renderReadonlyAgentSkills()

    expect(screen.getByRole('button', { name: 'Tender Analyzer' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    })).not.toBeInTheDocument()
  })

  it('should upload a skill through the drive-backed endpoint', async () => {
    const user = userEvent.setup()
    const driveSkills = [
      {
        archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        description: 'Extracts tender requirements and scoring criteria.',
        name: 'Tender Analyzer',
        path: 'tender-analyzer',
        skill_md_key: 'tender-analyzer/SKILL.md',
      },
      {
        description: '',
        name: 'Meeting Brief',
        path: 'meeting-brief',
        skill_md_key: 'meeting-brief/SKILL.md',
      },
    ]
    mocks.driveSkillsQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-skills', input],
      initialData: { items: [...driveSkills] },
      queryFn: async () => ({ items: [...driveSkills] }),
    }))
    const uploadSkill = vi.fn().mockImplementation(async () => {
      driveSkills.push({
        archive_key: 'invoice-helper/.DIFY-SKILL-FULL.zip',
        description: '',
        name: 'Invoice Helper',
        path: 'invoice-helper',
        skill_md_key: 'invoice-helper/SKILL.md',
      })
      return {
        manifest: {
          files: ['SKILL.md', 'scripts/run.py'],
          name: 'Invoice Helper',
        },
        skill: {
          manifest_files: ['SKILL.md', 'scripts/run.py'],
          name: 'Invoice Helper',
          path: 'invoice-helper',
          skill_md_key: 'invoice-helper/SKILL.md',
          archive_key: 'invoice-helper/.DIFY-SKILL-FULL.zip',
        },
      }
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
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('agentV2.agentDetail.configure.skills.upload.success')
  })

  it('should refresh the rendered skill list after delete succeeds', async () => {
    const driveSkills = [
      {
        archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        description: 'Extracts tender requirements and scoring criteria.',
        name: 'Tender Analyzer',
        path: 'tender-analyzer',
        skill_md_key: 'tender-analyzer/SKILL.md',
      },
      {
        description: '',
        name: 'Meeting Brief',
        path: 'meeting-brief',
        skill_md_key: 'meeting-brief/SKILL.md',
      },
    ]
    mocks.driveSkillsQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-skills', input],
      initialData: { items: [...driveSkills] },
      queryFn: async () => ({ items: [...driveSkills] }),
    }))
    const deleteSkill = vi.fn().mockImplementation(async () => {
      driveSkills.splice(0, 1)
      return { result: 'success', removed_keys: ['tender-analyzer/SKILL.md'] }
    })
    mocks.deleteSkillMutationOptions.mockReturnValue({
      mutationFn: deleteSkill,
      mutationKey: ['delete-skill'],
    })

    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Tender Analyzer' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Meeting Brief' })).toBeInTheDocument()
  })

  it('should route workflow skill uploads through app and node identifiers', async () => {
    const user = userEvent.setup()
    const uploadSkill = vi.fn().mockResolvedValue({
      manifest: {
        files: ['SKILL.md'],
        name: 'Invoice Helper',
      },
      skill: {
        name: 'Invoice Helper',
        path: 'invoice-helper',
        skill_md_key: 'invoice-helper/SKILL.md',
      },
    })
    mocks.uploadSkillMutationOptions.mockReturnValue({
      mutationFn: uploadSkill,
      mutationKey: ['upload-skill'],
    })

    renderWorkflowAgentSkills()

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.upload.action' }))

    await waitFor(() => {
      expect(uploadSkill.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
        },
        query: {
          node_id: 'node-1',
        },
        body: {
          file,
        },
      })
    })
  })

  it('should not persist skills_files when the draft is serialized', async () => {
    const user = userEvent.setup()
    const uploadSkill = vi.fn().mockResolvedValue({
      manifest: {
        files: ['SKILL.md', 'scripts/run.py'],
        name: 'Invoice Helper',
      },
      skill: {
        archive_key: 'invoice-helper/.DIFY-SKILL-FULL.zip',
        name: 'Invoice Helper',
        path: 'invoice-helper',
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
        <AgentDriveApiContextProvider value={{ agentId: 'agent-1' }}>
          <AgentComposerProvider initialDraft={agentSkillsDraft}>
            <AgentSkills />
            <ConfigSnapshotProbe />
          </AgentComposerProvider>
        </AgentDriveApiContextProvider>
      </QueryClientProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.add' }))

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(fileInput, file)
    await user.click(screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.upload.action' }))

    await waitFor(() => {
      const serializedConfig = JSON.parse(screen.getByTestId('config-snapshot-probe').textContent ?? '{}')
      expect(serializedConfig).not.toHaveProperty('skills_files')
    })
  })
})
