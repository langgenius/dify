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
import { AgentDriveApiContextProvider } from '../../drive-context'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentSkills } from '../index'

const mocks = vi.hoisted(() => ({
  driveSkillsQueryOptions: vi.fn(),
  driveSkillInspectQueryOptions: vi.fn(),
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
            bySkillPath: {
              inspect: {
                get: {
                  queryOptions: mocks.driveSkillInspectQueryOptions,
                },
              },
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
              bySkillPath: {
                inspect: {
                  get: {
                    queryOptions: mocks.driveSkillInspectQueryOptions,
                  },
                },
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
  skills: [
    {
      archiveKey: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
      description: 'Extracts tender requirements and scoring criteria.',
      id: 'tender-analyzer/SKILL.md',
      name: 'Tender Analyzer',
      path: 'tender-analyzer',
      skillMdKey: 'tender-analyzer/SKILL.md',
    },
    {
      id: 'meeting-brief/SKILL.md',
      name: 'Meeting Brief',
      path: 'meeting-brief',
      skillMdKey: 'meeting-brief/SKILL.md',
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
  const draft = useAtomValue(agentComposerDraftAtom)
  const configSnapshot = formStateToAgentSoulConfig({ formState: draft })

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
    mocks.driveSkillInspectQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-skill-inspect', input],
      queryFn: async () => ({
        archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        description: 'Extracts tender requirements and scoring criteria.',
        files: [
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/SKILL.md',
            name: 'SKILL.md',
            path: 'SKILL.md',
            type: 'file',
          },
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/references/guide.md',
            name: 'guide.md',
            path: 'references/guide.md',
            type: 'file',
          },
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/scripts/extract.py',
            name: 'extract.py',
            path: 'scripts/extract.py',
            type: 'file',
          },
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
            name: '.DIFY-SKILL-FULL.zip',
            path: '.DIFY-SKILL-FULL.zip',
            type: 'file',
          },
        ],
        name: 'Tender Analyzer',
        path: 'tender-analyzer',
        skill_md: {
          binary: false,
          key: 'tender-analyzer/SKILL.md',
          text: 'Skill markdown content',
          truncated: false,
        },
        skill_md_key: 'tender-analyzer/SKILL.md',
        source: 'drive',
        warnings: [],
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
    await waitFor(() => {
      expect(mocks.driveSkillInspectQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            agent_id: 'agent-1',
            skill_path: 'tender-analyzer',
          },
        },
      })
    })
    expect(mocks.driveFilesQueryOptions).not.toHaveBeenCalled()
    expect(within(dialog).getByText('Tender Analyzer')).toBeInTheDocument()
    expect(within(dialog).getByText('Extracts tender requirements and scoring criteria.')).toBeInTheDocument()
    expect(await within(dialog).findByText('references')).toBeInTheDocument()
    expect(within(dialog).getByText('guide.md')).toBeInTheDocument()
    expect(within(dialog).getByText('scripts')).toBeInTheDocument()
    expect(within(dialog).getByText('extract.py')).toBeInTheDocument()
    expect(within(dialog).queryByText('.DIFY-SKILL-FULL.zip')).not.toBeInTheDocument()
  })

  it('should keep the detail dialog open after selecting a skill', async () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('should preview selected package file content in the skill detail dialog', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    const dialog = screen.getByRole('dialog')
    await user.click(await within(dialog).findByText('guide.md'))

    expect(await within(dialog).findByText('Preview content for tender-analyzer/references/guide.md')).toBeInTheDocument()
    expect(mocks.driveFilePreviewQueryOptions).toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'tender-analyzer/references/guide.md',
        },
      },
    })
  })

  it('should not request preview for package files without a drive entry', async () => {
    const user = userEvent.setup()
    mocks.driveSkillInspectQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-skill-inspect', input],
      queryFn: async () => ({
        archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        description: 'Extracts tender requirements and scoring criteria.',
        files: [
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/SKILL.md',
            name: 'SKILL.md',
            path: 'SKILL.md',
            type: 'file',
          },
          {
            available_in_drive: false,
            drive_key: null,
            name: 'animation-rows.md',
            path: 'references/animation-rows.md',
            type: 'file',
          },
        ],
        name: 'Tender Analyzer',
        path: 'tender-analyzer',
        skill_md: {
          binary: false,
          key: 'tender-analyzer/SKILL.md',
          text: 'Skill markdown content',
          truncated: false,
        },
        skill_md_key: 'tender-analyzer/SKILL.md',
        source: 'drive',
        warnings: [],
      }),
    }))

    renderAgentSkills()

    await user.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    const dialog = screen.getByRole('dialog')
    await user.click(await within(dialog).findByText('animation-rows.md'))

    expect(mocks.driveFilePreviewQueryOptions).not.toHaveBeenCalledWith({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          key: 'tender-analyzer/references/animation-rows.md',
        },
      },
    })
    expect(within(dialog).getByText('agentV2.agentDetail.configure.files.preview.empty')).toBeInTheDocument()
  })

  it('should deduplicate package files by path in the skill detail dialog', async () => {
    const user = userEvent.setup()
    mocks.driveSkillInspectQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['agent-drive-skill-inspect', input],
      queryFn: async () => ({
        archive_key: 'tender-analyzer/.DIFY-SKILL-FULL.zip',
        description: 'Extracts tender requirements and scoring criteria.',
        files: [
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/SKILL.md',
            name: 'SKILL.md',
            path: 'SKILL.md',
            type: 'file',
          },
          {
            available_in_drive: false,
            drive_key: null,
            name: 'SKILL.md',
            path: 'tender-analyzer/SKILL.md',
            type: 'file',
          },
          {
            available_in_drive: true,
            drive_key: 'tender-analyzer/scripts/extract.py',
            name: 'extract.py',
            path: 'scripts/extract.py',
            type: 'file',
          },
        ],
        name: 'Tender Analyzer',
        path: 'tender-analyzer',
        skill_md: {
          binary: false,
          key: 'tender-analyzer/SKILL.md',
          text: 'Skill markdown content',
          truncated: false,
        },
        skill_md_key: 'tender-analyzer/SKILL.md',
        source: 'drive',
        warnings: [],
      }),
    }))

    renderAgentSkills()

    await user.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    const dialog = screen.getByRole('dialog')

    expect(await within(dialog).findByText('SKILL.md')).toBeInTheDocument()
    expect(within(dialog).getAllByText('SKILL.md')).toHaveLength(1)
    expect(within(dialog).getByText('agentV2.agentDetail.configure.skills.detail.fileCount:{"count":2}')).toBeInTheDocument()
  })

  it('should use workflow node drive routes for skill preview in inline workflow mode', async () => {
    renderWorkflowAgentSkills()

    expect(mocks.driveSkillsQueryOptions).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', {
      name: 'Tender Analyzer',
    }))

    await waitFor(() => {
      expect(mocks.driveSkillInspectQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            app_id: 'app-1',
            skill_path: 'tender-analyzer',
          },
          query: {
            node_id: 'node-1',
          },
        },
      })
    })
    fireEvent.click(await screen.findByText('guide.md'))

    await waitFor(() => {
      expect(mocks.driveFilePreviewQueryOptions).toHaveBeenCalledWith({
        input: {
          params: {
            app_id: 'app-1',
          },
          query: {
            node_id: 'node-1',
            key: 'tender-analyzer/references/guide.md',
          },
        },
      })
    })
  })

  it('should delete the skill without opening the detail dialog when the remove action is clicked', () => {
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should route Agent App skill delete through agent and slug identifiers', async () => {
    const deleteSkill = vi.fn().mockResolvedValue({ result: 'success', removed_keys: ['tender-analyzer/SKILL.md'] })
    mocks.deleteSkillMutationOptions.mockReturnValue({
      mutationFn: deleteSkill,
      mutationKey: ['delete-skill'],
    })
    renderAgentSkills()

    fireEvent.click(screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.remove.*Tender Analyzer/,
    }))

    await waitFor(() => {
      expect(deleteSkill.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
          slug: 'tender-analyzer',
        },
      })
    })
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
