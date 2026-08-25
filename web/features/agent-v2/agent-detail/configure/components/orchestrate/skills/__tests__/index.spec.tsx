import type { SkillResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AgentConfigApiContext } from '../../config-context'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { formStateToAgentSoulConfig } from '@/features/agent-v2/agent-composer/conversions'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { AgentOrchestrateAddActionsProvider } from '../../add-actions'
import { useAgentOrchestrateAddActions } from '../../add-actions-context'
import { AgentConfigApiContextProvider } from '../../config-context'
import {
  AgentOrchestrateReadOnlyContext,
  AgentOrchestrateViewingVersionContext,
} from '../../read-only-context'
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
  agentSkillBindingsKey: vi.fn((_options: unknown): unknown[] => ['workspace-agent-skills']),
  agentSkillBindingsQueryOptions: vi.fn((_options: unknown) => ({})),
  deleteSkillMutationFn: vi.fn(async (_input: unknown) => ({
    removed_names: ['Tender Analyzer'],
    result: 'success',
  })),
  replaceAgentSkillBindingsMutationFn: vi.fn(async (input: { body: { skill_ids?: string[] } }) => ({
    agent_id: 'agent-1',
    skill_ids: input.body.skill_ids ?? [],
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
  workspaceSkillsQueryOptions: vi.fn((_options: unknown) => ({})),
  workspaceSkillsInfiniteOptions: vi.fn((_options: unknown) => ({})),
  workspaceSkillTagsQueryOptions: vi.fn((_options: unknown) => ({})),
  downloadBlob: vi.fn(),
  downloadUrl: vi.fn(),
  fetch: vi.fn(),
  fileUploadConfig: {
    skill_file_size_limit: 64,
  },
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

vi.mock('@/service/use-common', () => ({
  useFileUploadConfig: () => ({ data: mocks.fileUploadConfig }),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  API_PREFIX: 'http://localhost:5001/console/api',
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['dataset.tag.manage'],
  }))
})

vi.mock('@/service/client', () => ({
  consoleQuery: {
    tags: {
      get: {
        queryOptions: mocks.workspaceSkillTagsQueryOptions,
      },
    },
    agent: {
      byAgentId: {
        composer: {
          get: {
            key: vi.fn((_options: unknown): unknown[] => ['agent-composer']),
          },
        },
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
    workspaces: {
      current: {
        agents: {
          byAgentId: {
            skills: {
              get: {
                key: mocks.agentSkillBindingsKey,
                queryOptions: mocks.agentSkillBindingsQueryOptions,
              },
              put: {
                mutationOptions: () => ({ mutationFn: mocks.replaceAgentSkillBindingsMutationFn }),
              },
            },
          },
        },
        skills: {
          get: {
            queryOptions: mocks.workspaceSkillsQueryOptions,
            infiniteOptions: mocks.workspaceSkillsInfiniteOptions,
          },
        },
      },
    },
  },
}))

async function openUploadSkillDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
  )
  await user.click(
    screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.upload\.label/i,
    }),
  )
}

function ConfigSnapshotProbe() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const configSnapshot = formStateToAgentSoulConfig({ formState: draft })

  return <pre aria-label="config snapshot">{JSON.stringify(configSnapshot)}</pre>
}

function PromptSkillAddProbe() {
  const actions = useAgentOrchestrateAddActions()
  const [addedSkill, setAddedSkill] = useState('')

  return (
    <>
      <button
        type="button"
        onClick={() =>
          actions.skills?.({
            skillSource: 'library',
            onAdded: (item) => setAddedSkill('name' in item ? (item.name ?? '') : ''),
          })
        }
      >
        prompt add from library
      </button>
      <button type="button" onClick={() => actions.skills?.({ skillSource: 'upload' })}>
        prompt upload skill.zip
      </button>
      <output aria-label="prompt added skill">{addedSkill}</output>
    </>
  )
}

function createWorkspaceSkill(overrides: Partial<SkillResponse> = {}): SkillResponse {
  return {
    id: 'workspace-skill-1',
    name: 'refund-approval',
    display_name: 'Refund approval',
    description: 'Handle refund requests.',
    icon: '💳',
    latest_published_version_id: 'version-1',
    reference_count: 0,
    tags: [],
    visibility: 'workspace',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
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
  viewingVersion = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  apiContext?: AgentConfigApiContext
  readOnly?: boolean
  viewingVersion?: boolean
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
          <AgentOrchestrateViewingVersionContext value={viewingVersion}>
            <AgentOrchestrateAddActionsProvider>
              <AgentOrchestrateReadOnlyContext value={readOnly}>
                <AgentSkills />
                <ConfigSnapshotProbe />
                <PromptSkillAddProbe />
              </AgentOrchestrateReadOnlyContext>
            </AgentOrchestrateAddActionsProvider>
          </AgentOrchestrateViewingVersionContext>
        </AgentComposerProvider>
      </AgentConfigApiContextProvider>
    </QueryClientProvider>,
  )
}

describe('AgentSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fileUploadConfig.skill_file_size_limit = 64
    vi.stubGlobal('fetch', mocks.fetch)
    document.cookie = 'csrf_token=csrf-token; path=/'
    mocks.fetch.mockResolvedValue(
      new Response('downloaded skill file', {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    )
    mocks.agentSkillBindingsKey.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }
      return ['workspace-agent-skills', input]
    })
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: async () => ({
          agent_id: input.params.agent_id,
          skill_ids: [],
          data: [],
        }),
      }
    })
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
          {
            path: 'assets/icon.png',
            name: 'icon.png',
            type: 'file',
            previewable: true,
            downloadable: true,
          },
          {
            path: 'models/model.bin',
            name: 'model.bin',
            type: 'file',
            previewable: false,
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
        binary: input.query.path.endsWith('.bin'),
        truncated: false,
        text: input.query.path.endsWith('.bin') ? null : `Preview for ${input.query.path}`,
      }),
    }))
    mocks.downloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['download-skill-file', input],
      queryFn: async () => ({
        url: `/console/api/agent/agent-1/config/skills/Tender%20Analyzer/files/content?path=${encodeURIComponent(input.query.path)}`,
      }),
    }))
    mocks.skillDownloadQueryOptions.mockImplementation(({ input }) => ({
      queryKey: ['download-skill', input],
      queryFn: async () => ({
        url: `https://example.com/${input.params.name}.skill`,
      }),
    }))
    mocks.workspaceSkillsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { query?: { keyword?: string } } }

      return {
        queryKey: ['workspace-skills', input],
        queryFn: async () => ({
          data: [],
        }),
      }
    })
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => {
          query?: { keyword?: string; limit?: number; page?: number }
        }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [],
          has_more: false,
          limit: input(pageParam).query?.limit ?? 20,
          page: pageParam,
          total: 0,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    mocks.workspaceSkillTagsQueryOptions.mockImplementation(() => ({
      queryKey: ['workspace-skill-tags'],
      queryFn: async () => [
        { id: 'tag-support', name: 'support', type: 'skill', binding_count: '1' },
        { id: 'tag-sales', name: 'sales', type: 'skill', binding_count: '1' },
      ],
    }))
  })

  afterEach(() => {
    document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    vi.unstubAllGlobals()
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

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Missing Skill"}',
      }),
    )
    expect(screen.queryByText('common.operation.download')).not.toBeInTheDocument()
    expect(screen.getByText('common.operation.delete')).toBeInTheDocument()
  })

  it('should delete a configured skill by config name', async () => {
    const user = userEvent.setup()
    const { container } = renderAgentSkills()

    const embeddedBadge = screen.getByText(
      'agentV2.agentDetail.configure.skills.addMenu.upload.badge',
    )
    expect(embeddedBadge).toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.agentDetail.configure.skills.itemType'),
    ).not.toBeInTheDocument()
    expect(
      screen
        .getByRole('button', { name: 'Tender Analyzer' })
        .querySelector('.i-custom-vender-agent-v2-building-blocks'),
    ).toHaveClass('text-text-secondary')

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Tender Analyzer"}',
      }),
    )
    expect(embeddedBadge).toHaveClass('opacity-0')

    const deleteAction = screen.getByText('common.operation.delete')
    fireEvent.mouseEnter(deleteAction.closest('[data-agent-skill-remove-button]')!)

    expect(container.querySelector('[data-agent-skill-row]')).toHaveClass(
      'border-state-destructive-border!',
      'bg-state-destructive-hover!',
    )

    await user.click(deleteAction)

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

    await openUploadSkillDialog(user)

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
    const snapshot = JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
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

  it('should open the upload flow from the prompt skill.zip action', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(screen.getByRole('button', { name: 'prompt upload skill.zip' }))

    expect(
      await screen.findByRole('dialog', {
        name: 'agentV2.agentDetail.configure.skills.upload.title',
      }),
    ).toBeInTheDocument()
  })

  it('should show the configured skill package size limit', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await openUploadSkillDialog(user)

    expect(
      await screen.findByText(
        'agentV2.agentDetail.configure.skills.upload.sizeLimit:{"sizeLimit":"64.00 MB"}',
      ),
    ).toBeInTheDocument()
  })

  it('should reject skill packages over the configured size limit', async () => {
    const user = userEvent.setup()
    mocks.fileUploadConfig.skill_file_size_limit = 1
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await openUploadSkillDialog(user)

    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]')
      expect(element).not.toBeNull()
      return element as HTMLInputElement
    })
    const oversizedFile = new File([new Uint8Array(1024 * 1024 + 1)], 'oversized-skill.skill', {
      type: 'application/zip',
    })
    await user.upload(input, oversizedFile)

    expect(toast.error).toHaveBeenCalledWith(
      'agentV2.agentDetail.configure.skills.upload.sizeLimit:{"sizeLimit":"1.00 MB"}',
    )
    expect(
      screen.getByRole('button', {
        name: /agentDetail\.configure\.skills\.upload\.action/i,
      }),
    ).toBeDisabled()

    vi.mocked(toast.error).mockClear()
    const allowedFile = new File([new Uint8Array(1024 * 1024)], 'allowed-skill.skill', {
      type: 'application/zip',
    })
    await user.upload(input, allowedFile)

    expect(screen.getByText('allowed-skill.skill')).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('should bind workspace skills without adding them to inline config skills', async () => {
    const user = userEvent.setup()
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => {
          query?: { keyword?: string; limit?: number; page?: number }
        }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [
            {
              id: 'workspace-skill-1',
              name: 'refund-approval',
              display_name: 'Refund approval',
              description: 'Handle refund requests.',
              icon: '💳',
              latest_published_version_id: 'version-1',
              reference_count: 0,
              tags: [],
              visibility: 'workspace',
              created_at: 1,
              updated_at: 1,
            },
          ],
          has_more: false,
          limit: 20,
          page: pageParam,
          total: 1,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    const workspaceMenuItem = screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
    })
    expect(
      workspaceMenuItem.querySelector('.i-custom-vender-agent-v2-building-blocks'),
    ).toHaveClass('text-text-secondary')
    await user.click(workspaceMenuItem)

    const workspaceSkillButton = await screen.findByRole('button', { name: /Refund approval/ })
    expect(
      workspaceSkillButton.querySelector('.i-custom-vender-agent-v2-building-blocks'),
    ).toHaveClass('text-text-secondary')
    expect(
      workspaceSkillButton.querySelector('.i-custom-vender-agent-v2-building-blocks')
        ?.parentElement,
    ).toHaveClass('border-effects-icon-border', 'bg-background-default-dodge')
    expect(screen.queryByText('💳')).not.toBeInTheDocument()
    await user.click(workspaceSkillButton)

    await waitFor(() => {
      expect(mocks.replaceAgentSkillBindingsMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          skill_ids: ['workspace-skill-1'],
        },
      })
    })

    const snapshot = JSON.parse(screen.getByLabelText('config snapshot').textContent ?? '{}')
    expect(snapshot.config_skills).toEqual([])
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('should not replace existing workspace skill bindings before they finish loading', async () => {
    const user = userEvent.setup()
    let resolveBindings:
      | ((value: { agent_id: string; skill_ids: string[]; data: never[] }) => void)
      | undefined
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: () =>
          new Promise<{ agent_id: string; skill_ids: string[]; data: never[] }>((resolve) => {
            resolveBindings = resolve
          }),
      }
    })
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => { query?: { limit?: number } }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [createWorkspaceSkill()],
          has_more: false,
          limit: input(pageParam).query?.limit ?? 20,
          page: pageParam,
          total: 1,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
      }),
    )

    const workspaceSkillButton = await screen.findByRole('button', { name: /Refund approval/ })
    expect(workspaceSkillButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(workspaceSkillButton)

    expect(mocks.replaceAgentSkillBindingsMutationFn).not.toHaveBeenCalled()

    resolveBindings?.({
      agent_id: 'agent-1',
      skill_ids: ['existing-skill'],
      data: [],
    })
    await waitFor(() => {
      expect(workspaceSkillButton).toHaveAttribute('aria-disabled', 'false')
    })
    await user.click(workspaceSkillButton)

    await waitFor(() => {
      expect(mocks.replaceAgentSkillBindingsMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          skill_ids: ['existing-skill', 'workspace-skill-1'],
        },
      })
    })
  })

  it('explains when an agent has reached the library skill limit', async () => {
    const user = userEvent.setup()
    mocks.replaceAgentSkillBindingsMutationFn.mockRejectedValueOnce({
      code: 'too_many_agent_skills',
    })
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => { query?: { limit?: number } }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [createWorkspaceSkill()],
          has_more: false,
          limit: input(pageParam).query?.limit ?? 20,
          page: pageParam,
          total: 1,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
      }),
    )
    await user.click(await screen.findByRole('button', { name: /Refund approval/ }))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'agentV2.agentDetail.configure.skills.workspaceSelector.limitReached',
      )
    })
  })

  it('blocks adding a 21st library skill and explains the limit before saving', async () => {
    const user = userEvent.setup()
    const boundSkills = Array.from({ length: 20 }, (_, index) =>
      createWorkspaceSkill({
        id: `bound-skill-${index}`,
        name: `bound-skill-${index}`,
        display_name: `Bound skill ${index}`,
      }),
    )
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: async () => ({
          agent_id: input.params.agent_id,
          skill_ids: boundSkills.map((skill) => skill.id),
          data: boundSkills.map((skill, priority) => ({
            ...skill,
            priority,
            status: 'published',
            file_count: 1,
            latest_published_at: 1,
          })),
        }),
      }
    })
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => { query?: { limit?: number } }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [createWorkspaceSkill({ id: 'candidate-skill' })],
          has_more: false,
          limit: input(pageParam).query?.limit ?? 20,
          page: pageParam,
          total: 1,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
      }),
    )
    await user.click(await screen.findByRole('button', { name: /Refund approval/ }))

    expect(toast.error).toHaveBeenCalledWith(
      'agentV2.agentDetail.configure.skills.workspaceSelector.limitReached',
    )
    expect(mocks.replaceAgentSkillBindingsMutationFn).not.toHaveBeenCalled()
  })

  it('should open the workspace skill tag filter and show skill tags', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
      }),
    )

    const tagFilter = await screen.findByRole('combobox', { name: 'common.tag.placeholder' })
    await user.click(tagFilter)
    expect(await screen.findByRole('option', { name: /support/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.tag.manageTags' })).not.toBeInTheDocument()
  })

  it('should open the library flow from the prompt and return the selected skill', async () => {
    const user = userEvent.setup()
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => { query?: { limit?: number } }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [createWorkspaceSkill()],
          has_more: false,
          limit: input(pageParam).query?.limit ?? 20,
          page: pageParam,
          total: 1,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(screen.getByRole('button', { name: 'prompt add from library' }))
    await user.click(await screen.findByRole('button', { name: /Refund approval/ }))

    expect(await screen.findByLabelText('prompt added skill')).toHaveTextContent('Refund approval')
  })

  it('should allow workflow agent nodes to bind workspace skills', async () => {
    const user = userEvent.setup()
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => {
          query?: { keyword?: string; limit?: number; page?: number }
        }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [
            {
              id: 'workspace-skill-1',
              name: 'refund-approval',
              display_name: 'Refund approval',
              description: 'Handle refund requests.',
              icon: '💳',
              latest_published_version_id: 'version-1',
              reference_count: 0,
              tags: [],
              visibility: 'workspace',
              created_at: 1,
              updated_at: 1,
            },
          ],
          has_more: false,
          limit: 20,
          page: pageParam,
          total: 1,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({
      initialDraft: defaultAgentSoulConfigFormState,
      apiContext: {
        agentId: 'workflow-agent-1',
        draftType: 'draft',
        workflow: {
          appId: 'workflow-app-1',
          nodeId: 'agent-node-1',
        },
      },
    })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    const workspaceMenuItem = screen.getByRole('button', {
      name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
    })
    expect(workspaceMenuItem).not.toBeDisabled()

    await user.click(workspaceMenuItem)
    await user.click(await screen.findByRole('button', { name: /Refund approval/ }))

    await waitFor(() => {
      expect(mocks.replaceAgentSkillBindingsMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'workflow-agent-1',
        },
        body: {
          skill_ids: ['workspace-skill-1'],
        },
      })
    })
  })

  it('should hide draft workspace skills and mark published skills as added', async () => {
    const user = userEvent.setup()
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: async () => ({
          agent_id: input.params.agent_id,
          skill_ids: ['workspace-skill-1'],
          data: [
            {
              ...createWorkspaceSkill(),
              priority: 0,
              status: 'published',
              file_count: 1,
              latest_published_at: 1,
            },
          ],
        }),
      }
    })
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => {
          query?: { keyword?: string; limit?: number; page?: number }
        }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data: [
            createWorkspaceSkill(),
            createWorkspaceSkill({
              description: 'Draft skill description.',
              id: 'draft-skill',
              name: 'draft-skill',
              display_name: 'Draft skill',
              latest_published_version_id: null,
            }),
          ],
          has_more: false,
          limit: 20,
          page: pageParam,
          total: 2,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
      }),
    )

    expect(
      await screen.findByText('agentV2.agentDetail.configure.skills.workspaceSelector.added'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Draft skill')).not.toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.agentDetail.configure.skills.workspaceSelector.draft'),
    ).not.toBeInTheDocument()

    const addedSkillButton = screen
      .getByText('agentV2.agentDetail.configure.skills.workspaceSelector.added')
      .closest('button')
    expect(addedSkillButton).not.toBeDisabled()
    expect(addedSkillButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(addedSkillButton!)

    expect(mocks.replaceAgentSkillBindingsMutationFn).not.toHaveBeenCalled()
  })

  it('should fetch the next workspace skill page when scrolling the selector', async () => {
    const user = userEvent.setup()
    mocks.workspaceSkillsInfiniteOptions.mockImplementation((options) => {
      const { input, getNextPageParam, initialPageParam } = options as {
        input: (pageParam: number) => {
          query?: { keyword?: string; limit?: number; page?: number }
        }
        getNextPageParam: (lastPage: { has_more?: boolean; page?: number }) => number | undefined
        initialPageParam: number
      }

      return {
        queryKey: ['workspace-skills', input(initialPageParam)],
        queryFn: async ({ pageParam = initialPageParam }: { pageParam?: number }) => ({
          data:
            pageParam === 1
              ? [createWorkspaceSkill()]
              : [
                  createWorkspaceSkill({
                    id: 'workspace-skill-2',
                    name: 'sales-follow-up',
                    display_name: 'Sales follow-up',
                  }),
                ],
          has_more: pageParam === 1,
          limit: 20,
          page: pageParam,
          total: 2,
        }),
        getNextPageParam,
        initialPageParam,
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      screen.getByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    )
    await user.click(
      screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.addMenu\.workspace\.label/i,
      }),
    )
    await waitFor(() => {
      expect(screen.getAllByText('Refund approval').length).toBeGreaterThan(1)
    })

    const scrollContainer = document.querySelector('.overflow-y-auto')
    expect(scrollContainer).not.toBeNull()
    Object.defineProperties(scrollContainer!, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 160 },
      scrollTop: { configurable: true, value: 80 },
    })
    fireEvent.scroll(scrollContainer!)

    expect(await screen.findByText('Sales follow-up')).toBeInTheDocument()
  })

  it('should remove workspace skill bindings from the configured agent', async () => {
    const user = userEvent.setup()
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: async () => ({
          agent_id: input.params.agent_id,
          skill_ids: ['workspace-skill-1'],
          data: [
            {
              ...createWorkspaceSkill(),
              priority: 0,
              status: 'published',
              file_count: 1,
              latest_published_at: 1,
            },
          ],
        }),
      }
    })
    const { container } = renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Refund approval"}',
      }),
    )
    expect(screen.getByText('refund-approval')).toHaveClass('opacity-0')

    const removeAction = await screen.findByText(
      'agentV2.agentDetail.configure.skills.removeAction',
    )
    fireEvent.mouseEnter(removeAction.closest('[data-workspace-skill-remove-action]')!)

    expect(container.querySelector('[data-workspace-skill-row]')).toHaveClass(
      'border-state-destructive-border!',
      'bg-state-destructive-hover!',
    )

    await user.click(removeAction)

    await waitFor(() => {
      expect(mocks.replaceAgentSkillBindingsMutationFn.mock.calls[0]?.[0]).toEqual({
        params: {
          agent_id: 'agent-1',
        },
        body: {
          skill_ids: [],
        },
      })
    })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('should open workspace skill details in a new tab from the row menu', async () => {
    const user = userEvent.setup()
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: async () => ({
          agent_id: input.params.agent_id,
          skill_ids: ['workspace-skill-1'],
          data: [
            {
              ...createWorkspaceSkill(),
              priority: 0,
              status: 'published',
              file_count: 1,
              latest_published_at: 1,
            },
          ],
        }),
      }
    })
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Refund approval"}',
      }),
    )
    await user.click(await screen.findByText('agentV2.agentDetail.configure.skills.openInLibrary'))

    expect(openSpy).toHaveBeenCalledWith(
      '/skills/workspace-skill-1',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('should hide skill package guidance before an upload fails', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ initialDraft: defaultAgentSoulConfigFormState })

    await openUploadSkillDialog(user)

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

    await openUploadSkillDialog(user)
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

    await openUploadSkillDialog(user)

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

    await openUploadSkillDialog(user)
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
              app_id: 'app-1',
              name: 'Tender Analyzer',
            },
            query: {
              draft_type: 'draft',
              node_id: 'node-1',
              path: 'references/guide.md',
              version_id: 'draft-1',
            },
          }),
        }),
      )
    })
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'guide.md',
    })
  })

  it('should download a whole skill package from the row action', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Tender Analyzer"}',
      }),
    )
    await user.click(screen.getByText('common.operation.download'))

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

  it('should expose only download for an embedded skill while a build draft is read-only', async () => {
    const user = userEvent.setup()
    renderAgentSkills({
      apiContext: { agentId: 'agent-1', draftType: 'debug_build' },
      readOnly: true,
    })

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Tender Analyzer"}',
      }),
    )

    expect(screen.getByText('common.operation.download')).toBeInTheDocument()
    expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
    expect(mocks.deleteSkillMutationFn).not.toHaveBeenCalled()
  })

  it('should expose only download from an embedded skill row when viewing a version', async () => {
    const user = userEvent.setup()
    renderAgentSkills({ readOnly: true, viewingVersion: true })

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Tender Analyzer"}',
      }),
    )

    expect(screen.getByText('common.operation.download')).toBeInTheDocument()
    expect(screen.queryByText('common.operation.delete')).not.toBeInTheDocument()
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
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Tender Analyzer"}',
      }),
    )
    await user.click(screen.getByText('common.operation.download'))

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
    expect(skillMdCode).toHaveClass('wrap-anywhere')
    expect(skillMdCode).toHaveClass('wrap-break-word')
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
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://localhost:5001/console/api/agent/agent-1/config/skills/Tender%20Analyzer/files/content?path=references%2Fguide.md',
      {
        credentials: 'include',
        headers: {
          'X-CSRF-Token': 'csrf-token',
        },
      },
    )
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'guide.md',
    })
    const blob = mocks.downloadBlob.mock.calls[0]?.[0].data as Blob
    await expect(blob.text()).resolves.toBe('downloaded skill file')
    expect(mocks.downloadUrl).not.toHaveBeenCalled()
  })

  it('should show an error when the authenticated skill member request fails', async () => {
    const user = userEvent.setup()
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }))
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
      expect(toast.error).toHaveBeenCalledWith('common.operation.downloadFailed')
    })
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('should download binary skill members without exposing the protected URL', async () => {
    const user = userEvent.setup()
    renderAgentSkills()

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)
    await user.click(await screen.findByText('models'))
    await user.click(screen.getByText('model.bin').closest('button')!)

    const downloadLink = await screen.findByRole('link', {
      name: 'common.operation.download',
    })
    expect(downloadLink).toHaveAttribute('href', '#')

    await user.click(downloadLink)

    await waitFor(() => {
      expect(mocks.downloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: 'model.bin',
      })
    })
  })

  it('should preview and download image skill members from an authenticated Blob', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:skill-image')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const view = renderAgentSkills()

    await user.click(screen.getByText('Tender Analyzer').closest('button')!)
    await user.click(await screen.findByText('assets'))
    await user.click(screen.getByText('icon.png').closest('button')!)

    const image = await screen.findByRole('img', { name: 'icon.png' })
    expect(image).toHaveAttribute('src', 'blob:skill-image')
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))

    await user.click(
      screen.getByRole('button', {
        name: /common\.operation\.download.*icon\.png/,
      }),
    )
    await waitFor(() => {
      expect(mocks.downloadBlob).toHaveBeenCalledWith({
        data: expect.any(Blob),
        fileName: 'icon.png',
      })
    })

    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:skill-image')
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

  it('should disable add and remove actions when viewing a version', async () => {
    const user = userEvent.setup()
    mocks.agentSkillBindingsQueryOptions.mockImplementation((options) => {
      const { input } = options as { input: { params: { agent_id: string } } }

      return {
        queryKey: ['workspace-agent-skills', input],
        queryFn: async () => ({
          agent_id: input.params.agent_id,
          skill_ids: ['workspace-skill-1'],
          data: [
            {
              ...createWorkspaceSkill(),
              priority: 0,
              status: 'published',
              file_count: 1,
              latest_published_at: 1,
            },
          ],
        }),
      }
    })
    const { container } = renderAgentSkills({
      apiContext: {
        agentId: 'agent-1',
        draftType: 'draft',
        versionId: 'version-1',
      },
      readOnly: true,
      viewingVersion: true,
    })

    expect(
      screen.queryByRole('button', { name: /agentV2\.agentDetail\.configure\.skills\.add/i }),
    ).not.toBeInTheDocument()
    expect(container.querySelector('[data-agent-skill-remove-button]')).toBeNull()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.agentDetail.configure.skills.moreActions:{"name":"Refund approval"}',
      }),
    )

    expect(
      screen.getByText('agentV2.agentDetail.configure.skills.openInLibrary'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('agentV2.agentDetail.configure.skills.removeAction'),
    ).not.toBeInTheDocument()
    expect(mocks.replaceAgentSkillBindingsMutationFn).not.toHaveBeenCalled()
  })

  it('should hide the add action while a build draft is read-only', () => {
    renderAgentSkills({
      apiContext: {
        agentId: 'agent-1',
        draftType: 'debug_build',
      },
      initialDraft: {
        ...defaultAgentSoulConfigFormState,
        skills: [],
      },
      readOnly: true,
    })

    expect(
      screen.queryByRole('button', {
        name: /agentV2\.agentDetail\.configure\.skills\.add/i,
      }),
    ).not.toBeInTheDocument()
  })
})
