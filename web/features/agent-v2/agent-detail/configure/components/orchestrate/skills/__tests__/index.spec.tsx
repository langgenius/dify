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
import { AgentSkills } from '../index'

type ConfigSkillInspectQueryOptionsInput = {
  input: {
    params: {
      name: string
    }
  }
}

type ConfigSkillFileQueryOptionsInput = {
  input: {
    query: {
      path: string
    }
  }
}

type ConfigSkillDownloadQueryOptionsInput = {
  input: {
    params: {
      name: string
    }
  }
}

const mocks = vi.hoisted(() => ({
  deleteSkillMutationFn: vi.fn(async (_input: unknown) => ({
    removed_names: ['Tender Analyzer'],
    result: 'success',
  })),
  uploadSkillMutationFn: vi.fn(async (_input: unknown) => ({
    config_version: { id: 'draft-1', kind: 'draft', writable: true },
    skill: {
      id: 'Invoice Helper',
      name: 'Invoice Helper',
      file_id: 'tool-file-2',
      description: 'Summarizes invoices.',
      hash: 'sha256:skill-2',
      mime_type: 'application/zip',
      size: 128,
    },
  })),
  skillDownloadQueryOptions: vi.fn((_options: ConfigSkillDownloadQueryOptionsInput) => ({})),
  inspectQueryOptions: vi.fn((_options: ConfigSkillInspectQueryOptionsInput) => ({})),
  previewQueryOptions: vi.fn((_options: ConfigSkillFileQueryOptionsInput) => ({})),
  downloadQueryOptions: vi.fn((_options: ConfigSkillFileQueryOptionsInput) => ({})),
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
          skills: {
            upload: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.uploadSkillMutationFn }),
              },
            },
            byName: {
              delete: {
                mutationOptions: () => ({ mutationFn: mocks.deleteSkillMutationFn }),
              },
              download: {
                get: {
                  queryOptions: mocks.skillDownloadQueryOptions,
                },
              },
              inspect: {
                get: {
                  queryOptions: mocks.inspectQueryOptions,
                },
              },
              files: {
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
    apps: {
      byAppId: {
        agent: {
          config: {
            skills: {
              upload: {
                post: {
                  mutationOptions: () => ({ mutationFn: mocks.uploadSkillMutationFn }),
                },
              },
              byName: {
                delete: {
                  mutationOptions: () => ({ mutationFn: mocks.deleteSkillMutationFn }),
                },
                download: {
                  get: {
                    queryOptions: mocks.skillDownloadQueryOptions,
                  },
                },
                inspect: {
                  get: {
                    queryOptions: mocks.inspectQueryOptions,
                  },
                },
                files: {
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
    },
  },
}))

function ConfigSnapshotProbe() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const configSnapshot = formStateToAgentSoulConfig({ formState: draft })

  return <pre data-testid="config-snapshot-probe">{JSON.stringify(configSnapshot)}</pre>
}

function renderAgentSkills({
  initialDraft = {
    ...defaultAgentSoulConfigFormState,
    skills: [
      {
        id: 'Tender Analyzer',
        name: 'Tender Analyzer',
        description: 'Extracts tender requirements.',
        fileId: 'tool-file-1',
      },
    ],
  },
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
            <AgentSkills />
            <ConfigSnapshotProbe />
          </AgentOrchestrateReadOnlyContext>
        </AgentComposerProvider>
      </AgentConfigApiContextProvider>
    </QueryClientProvider>,
  )
}

describe('AgentSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.inspectQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['inspect-skill', input],
      queryFn: async () => ({
        id: input.params.name,
        name: input.params.name,
        description: 'Inspect skill',
        source: 'config_skill_zip',
        files: [
          {
            path: 'SKILL.md',
            name: 'SKILL.md',
            type: 'file',
            previewable: true,
            downloadable: true,
          },
          {
            path: 'references/guide.md',
            name: 'guide.md',
            type: 'file',
            previewable: true,
            downloadable: true,
          },
        ],
        skill_md: {
          path: 'SKILL.md',
          size: 16,
          truncated: false,
          binary: false,
          text: '# Skill\n',
        },
        warnings: [],
      }),
    }))
    mocks.previewQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['preview-skill-file', input],
      queryFn: async () => ({
        path: input.query.path,
        binary: false,
        truncated: false,
        text: `Preview for ${input.query.path}`,
      }),
    }))
    mocks.downloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['download-skill-file', input],
      queryFn: async () => ({
        url: `https://example.com/${input.query.path}`,
      }),
    }))
    mocks.skillDownloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['download-skill', input],
      queryFn: async () => ({
        url: `https://example.com/${input.params.name}.skill`,
      }),
    }))
  })

  it('should prevent missing skills from being previewed or downloaded', async () => {
    const user = userEvent.setup()
    renderAgentSkills({
      initialDraft: {
        ...defaultAgentSoulConfigFormState,
        skills: [
          {
            id: 'Missing Skill',
            name: 'Missing Skill',
            fileId: 'missing-skill-id',
            isMissing: true,
          },
          {
            id: 'Available Skill',
            name: 'Available Skill',
            fileId: 'available-skill-id',
          },
        ],
      },
    })

    const warning = screen.getByRole('button', {
      name: 'agentV2.agentDetail.configure.skills.missing',
    })
    expect(warning.querySelector('.i-ri-alert-fill')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.missing',
      }),
    ).toHaveLength(1)

    const missingSkill = screen.getByRole('button', { name: 'Missing Skill' })
    expect(missingSkill).toBeDisabled()
    expect(
      screen.queryByRole('button', {
        name: /common\.operation\.download Missing Skill/,
      }),
    ).not.toBeInTheDocument()

    await user.click(missingSkill)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should delete a configured skill by config name', async () => {
    const { container } = renderAgentSkills()

    const removeButton = container.querySelector('[data-agent-skill-remove-button]')
    expect(removeButton).not.toBeNull()

    fireEvent.click(removeButton!)

    await waitFor(() => {
      expect(mocks.deleteSkillMutationFn).toHaveBeenCalled()
      expect(mocks.deleteSkillMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
          name: 'Tender Analyzer',
        },
        query: {
          draft_type: 'draft',
          version_id: undefined,
        },
      })
    })

    expect(screen.queryByText('Tender Analyzer')).not.toBeInTheDocument()
  })

  it('should upload a skill through the config endpoint and add it to the draft UI', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(input, file)
    await user.click(
      screen.getByRole('button', { name: /agentDetail\.configure\.skills\.upload\.action/i }),
    )

    await waitFor(() => {
      expect(mocks.uploadSkillMutationFn).toHaveBeenCalled()
      expect(mocks.uploadSkillMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        query: {
          draft_type: 'draft',
          version_id: undefined,
        },
        body: {
          file,
        },
      })
    })

    expect(screen.getByText('Invoice Helper')).toBeInTheDocument()
    const snapshot = JSON.parse(screen.getByTestId('config-snapshot-probe').textContent ?? '{}')
    expect(snapshot.config_skills).toEqual([
      expect.objectContaining({
        name: 'Invoice Helper',
        file_id: 'tool-file-2',
        file_kind: 'tool_file',
        hash: 'sha256:skill-2',
        mime_type: 'application/zip',
        size: 128,
      }),
    ])
    expect(toast.success).toHaveBeenCalled()
  })

  it('should hide skill package guidance before an upload fails', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )

    expect(
      screen.queryByText('agentV2.agentDetail.configure.skills.upload.warning.specification'),
    ).not.toBeInTheDocument()
  })

  it('should show skill package guidance after failure and hide it when retrying', async () => {
    const user = userEvent.setup()
    mocks.uploadSkillMutationFn
      .mockRejectedValueOnce(new Error('Backend upload error'))
      .mockImplementationOnce(() => new Promise<never>(() => undefined))
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    await user.upload(
      input,
      new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' }),
    )
    const uploadButton = screen.getByRole('button', {
      name: /agentDetail\.configure\.skills\.upload\.action/i,
    })

    await user.click(uploadButton)

    expect(
      await screen.findByText('agentV2.agentDetail.configure.skills.upload.warning.files'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('agentV2.agentDetail.configure.skills.upload.warning.specification'),
    ).toBeInTheDocument()

    await user.click(uploadButton)

    await waitFor(() => {
      expect(
        screen.queryByText('agentV2.agentDetail.configure.skills.upload.warning.files'),
      ).not.toBeInTheDocument()
    })
  })

  it('should not show the frontend fallback error when skill upload fails', async () => {
    const user = userEvent.setup()
    mocks.uploadSkillMutationFn.mockRejectedValueOnce(new Error('Backend upload error'))
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(input, file)
    await user.click(
      screen.getByRole('button', { name: /agentDetail\.configure\.skills\.upload\.action/i }),
    )

    await waitFor(() => {
      expect(mocks.uploadSkillMutationFn).toHaveBeenCalled()
    })

    expect(toast.error).not.toHaveBeenCalledWith(
      'agentV2.agentDetail.configure.skills.upload.failed',
    )
  })

  it('should use workflow config skill endpoints with node_id for uploads and skill member queries', async () => {
    const user = userEvent.setup()
    renderAgentSkills({
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
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const file = new File(['skill'], 'invoice-helper.skill', { type: 'application/zip' })
    await user.upload(input, file)
    await user.click(
      screen.getByRole('button', { name: /agentDetail\.configure\.skills\.upload\.action/i }),
    )

    await waitFor(() => {
      expect(mocks.uploadSkillMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          app_id: 'app-1',
        },
        query: {
          draft_type: 'draft',
          node_id: 'node-1',
          version_id: 'draft-1',
        },
        body: {
          file,
        },
      })
    })

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)

    await waitFor(() => {
      expect(mocks.inspectQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              app_id: 'app-1',
              name: 'Tender Analyzer',
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

  it('should download a whole skill package from the row action', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.download.*Tender Analyzer/,
      }),
    )

    await waitFor(() => {
      expect(mocks.skillDownloadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'Tender Analyzer',
            },
            query: {
              draft_type: 'draft',
              version_id: undefined,
            },
          }),
        }),
      )
    })
    expect(mocks.downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/Tender Analyzer.skill',
      fileName: 'Tender Analyzer',
    })
  })

  it('should download a whole workflow skill package with node_id', async () => {
    const user = userEvent.setup()
    renderAgentSkills({
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
      screen.getByRole('button', {
        name: /common\.operation\.download.*Tender Analyzer/,
      }),
    )

    await waitFor(() => {
      expect(mocks.skillDownloadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              app_id: 'app-1',
              name: 'Tender Analyzer',
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

  it('should inspect skills by config name and preview package members by member path', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)

    await waitFor(() => {
      expect(mocks.inspectQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'Tender Analyzer',
            },
          }),
        }),
      )
    })

    await user.click(screen.getByText('references').closest('button')!)
    await user.click(screen.getByText('guide.md').closest('button')!)

    await waitFor(() => {
      expect(mocks.previewQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'Tender Analyzer',
            },
            query: expect.objectContaining({
              path: 'references/guide.md',
            }),
          }),
        }),
      )
    })
  })

  it('should wrap long preview lines instead of forcing a horizontal code block', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)

    const skillMdCode = await screen.findByText('# Skill')
    expect(skillMdCode.tagName).toBe('CODE')
    expect(skillMdCode).toHaveClass('[overflow-wrap:anywhere]')
    expect(skillMdCode).toHaveClass('break-words')
    expect(skillMdCode).toHaveClass('whitespace-pre-wrap')
    expect(skillMdCode).not.toHaveClass('whitespace-pre')
    expect(skillMdCode).not.toHaveClass('min-w-max')
  })

  it('should download skill package members from the detail file tree', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)
    await user.click(await screen.findByText('references'))
    await user.click(screen.getByText('guide.md').closest('button')!)
    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.download.*guide\.md/,
      }),
    )

    await waitFor(() => {
      expect(mocks.downloadQueryOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            params: {
              agent_id: 'agent-1',
              name: 'Tender Analyzer',
            },
            query: expect.objectContaining({
              path: 'references/guide.md',
            }),
          }),
        }),
      )
    })
    expect(mocks.downloadUrl).toHaveBeenCalledWith({
      url: 'https://example.com/references/guide.md',
      fileName: 'guide.md',
    })
  })

  it('should download inspected SKILL.md content as markdown', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)
    await user.click(
      await screen.findByRole('button', {
        name: /common\.operation\.download.*SKILL\.md/,
      }),
    )

    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'SKILL.md',
    })
    const blob = mocks.downloadBlob.mock.calls[0]?.[0].data as Blob
    await expect(blob.text()).resolves.toBe('# Skill\n')
    expect(mocks.downloadQueryOptions).not.toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          query: expect.objectContaining({
            path: 'SKILL.md',
          }),
        }),
      }),
    )
  })

  it('should disable add and remove actions when the section is read only', () => {
    const { container } = renderAgentSkills({ readOnly: true })

    expect(
      screen.queryByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    ).not.toBeInTheDocument()
    expect(container.querySelector('[data-agent-skill-remove-button]')).toBeNull()
  })
})
