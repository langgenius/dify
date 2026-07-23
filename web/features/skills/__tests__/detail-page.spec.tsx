import type {
  SkillDetailResponse,
  SkillReferenceResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillDetailPage from '../detail-page'

const mocks = vi.hoisted(() => ({
  fetchSkillFileBlob: vi.fn(),
  publishSkillMutationFn: vi.fn(),
  restoreSkillMutationFn: vi.fn(),
  saveDraftFileMutationFn: vi.fn(),
  sendSkillAssistMessage: vi.fn(),
  defaultTextGenerationModel: undefined as
    | { provider: { provider: string }; model: string }
    | undefined,
  skillDetail: undefined as SkillDetailResponse | undefined,
  skillDetailKey: vi.fn((_options: unknown): unknown[] => ['skill-detail']),
  skillDetailQueryOptions: vi.fn((_options: unknown) => ({})),
  skillListKey: vi.fn((_options: unknown): unknown[] => ['skills']),
  skillMetadataMutationFn: vi.fn(),
  skillReferencesQueryOptions: vi.fn((_options: unknown) => ({})),
  skillTagsKey: vi.fn((_options: unknown): unknown[] => ['skill-tags']),
  skillVersionsKey: vi.fn((_options: unknown): unknown[] => ['skill-versions']),
  skillVersionsQueryOptions: vi.fn((_options: unknown) => ({})),
  skillVersionDetailQueryOptions: vi.fn((_options: unknown) => ({})),
  textGenerationModelList: [] as {
    provider: string
    status: string
    models: { model: string; status: string }[]
  }[],
  uploadSkillFile: vi.fn(),
  versionDeleteMutationFn: vi.fn(),
  versionPatchMutationFn: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon }: { icon?: string }) => <span>{icon}</span>,
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: mocks.defaultTextGenerationModel,
  }),
  useModelList: () => ({
    data: mocks.textGenerationModelList,
    isLoading: false,
  }),
}))

vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => <button type="button">model-settings</button>,
  }),
)

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ onChange, value }: { onChange?: (value: string) => void; value: string }) => (
    <textarea
      aria-label="code-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/hooks/use-format-time-from-now', () => ({
  useFormatTimeFromNow: () => ({
    formatTimeFromNow: () => 'just now',
  }),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: () => '2026-07-21 12:00',
  }),
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/next/navigation', () => ({
  useParams: () => ({
    skillId: 'skill-1',
  }),
}))

vi.mock('@/service/client', () => ({
  consoleQuery: {
    workspaces: {
      current: {
        skills: {
          get: {
            key: mocks.skillListKey,
          },
          tags: {
            get: {
              key: mocks.skillTagsKey,
            },
          },
          bySkillId: {
            get: {
              key: mocks.skillDetailKey,
              queryOptions: mocks.skillDetailQueryOptions,
            },
            patch: {
              mutationOptions: () => ({ mutationFn: mocks.skillMetadataMutationFn }),
            },
            publish: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.publishSkillMutationFn }),
              },
            },
            references: {
              get: {
                queryOptions: mocks.skillReferencesQueryOptions,
              },
            },
            restore: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.restoreSkillMutationFn }),
              },
            },
            files: {
              patch: {
                mutationOptions: () => ({ mutationFn: mocks.saveDraftFileMutationFn }),
              },
            },
            versions: {
              get: {
                key: mocks.skillVersionsKey,
                queryOptions: mocks.skillVersionsQueryOptions,
              },
              byVersionId: {
                get: {
                  queryOptions: mocks.skillVersionDetailQueryOptions,
                },
                patch: {
                  mutationOptions: () => ({ mutationFn: mocks.versionPatchMutationFn }),
                },
                delete: {
                  mutationOptions: () => ({ mutationFn: mocks.versionDeleteMutationFn }),
                },
              },
            },
          },
        },
      },
    },
  },
}))

vi.mock('../client', () => ({
  fetchSkillFileBlob: mocks.fetchSkillFileBlob,
  sendSkillAssistMessage: mocks.sendSkillAssistMessage,
  uploadSkillFile: mocks.uploadSkillFile,
}))

function createSkillDetail(overrides: Partial<SkillDetailResponse> = {}): SkillDetailResponse {
  return {
    id: 'skill-1',
    name: 'github-actions-failure-debugging',
    display_name: 'Untitled skill',
    icon: '📄',
    description: 'Guide for debugging failing GitHub Actions workflows.',
    tags: [],
    name_manually_edited: true,
    visibility: 'workspace',
    latest_published_version_id: 'version-1',
    reference_count: 0,
    created_by: 'user-1',
    created_by_name: 'Fate',
    updated_by: 'user-1',
    updated_by_name: 'Fate',
    created_at: 1784631405,
    updated_at: 1784638487,
    files: [
      {
        id: 'file-1',
        path: 'SKILL.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content:
          '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n# GitHub Actions Failure Debugging\n',
        tool_file_id: null,
        size: 180,
        hash: 'hash-1',
      },
    ],
    ...overrides,
  }
}

function createSkillVersion(overrides: Partial<SkillVersionResponse> = {}): SkillVersionResponse {
  return {
    id: 'version-1',
    skill_id: 'skill-1',
    version_number: 1,
    version_name: 'Initial version',
    publish_note: 'Original instructions',
    hash_code: 'hash-code-1',
    archive_size: 180,
    published_by: 'user-1',
    published_by_name: 'Fate',
    created_at: 1784638400,
    is_latest: false,
    ...overrides,
  }
}

function createAgentReference(
  overrides: Partial<SkillReferenceResponse> = {},
): SkillReferenceResponse {
  return {
    agent_id: 'agent-1',
    agent_icon: '🤖',
    agent_icon_background: '#EFF6FF',
    agent_icon_type: 'emoji',
    app_id: 'app-1',
    display_name: 'Support Agent',
    name: 'support-agent',
    type: 'agent',
    ...overrides,
  }
}

function renderSkillDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SkillDetailPage />
    </QueryClientProvider>,
  )
}

function getBuilderAttachmentInput(container: HTMLElement) {
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
  return inputs.at(-1) ?? null
}

function getSourceEditor() {
  const editors = screen.getAllByRole('textbox')
  const sourceEditor = editors.find(
    (editor): editor is HTMLTextAreaElement =>
      editor instanceof HTMLTextAreaElement &&
      editor.value.includes('name: github-actions-failure-debugging'),
  )

  if (!sourceEditor) throw new Error('source editor not found')

  return sourceEditor
}

function getFileTreeItem(path: string) {
  const fileButton = document.querySelector(`[title="${path}"]`)
  const treeItem = fileButton?.closest('[data-skill-file-tree-item]')
  if (!(treeItem instanceof HTMLElement)) throw new Error(`file tree item not found: ${path}`)

  return treeItem
}

async function openFileTreeActions(user: ReturnType<typeof userEvent.setup>, path: string) {
  const treeItem = getFileTreeItem(path)
  await user.click(within(treeItem).getByRole('button', { name: 'common.operation.more' }))
}

async function openRootCreateMenu(user: ReturnType<typeof userEvent.setup>) {
  const triggers = Array.from(document.querySelectorAll('aside .i-ri-add-line'))
    .map((icon) => icon.closest('button'))
    .filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement)
  const trigger = triggers.at(-1)
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('root create menu trigger not found')

  await user.click(trigger)
}

async function openVersionRowActions(
  user: ReturnType<typeof userEvent.setup>,
  versionName: string,
) {
  const versionText = await screen.findByText(versionName)
  const versionRow = versionText.closest('li')
  if (!(versionRow instanceof HTMLElement)) throw new Error(`version row not found: ${versionName}`)
  const buttons = within(versionRow).getAllByRole('button')
  const actionButton = buttons.at(-1)
  if (!actionButton) throw new Error(`version row action not found: ${versionName}`)

  await user.click(actionButton)
}

describe('SkillDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.defaultTextGenerationModel = {
      provider: {
        provider: 'langgenius/openai/openai',
      },
      model: 'gpt-5.5',
    }
    mocks.textGenerationModelList = [
      {
        provider: 'langgenius/openai/openai',
        status: 'active',
        models: [
          {
            model: 'gpt-5.5',
            status: 'active',
          },
        ],
      },
    ]
    mocks.skillDetail = createSkillDetail()
    mocks.skillDetailKey.mockImplementation((options) => ['skill-detail', options])
    mocks.skillVersionsKey.mockImplementation((options) => ['skill-versions', options])
    mocks.skillListKey.mockImplementation((options) => ['skills', options])
    mocks.skillTagsKey.mockImplementation((options) => ['skill-tags', options])
    mocks.skillDetailQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-detail', options],
      queryFn: async () => mocks.skillDetail,
    }))
    mocks.skillVersionsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-versions', options],
      queryFn: async () => ({
        data: [],
      }),
    }))
    mocks.skillVersionDetailQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-version-detail', options],
      queryFn: async () => ({
        ...mocks.skillDetail,
        files: [],
      }),
    }))
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: [],
      }),
    }))
    mocks.saveDraftFileMutationFn.mockImplementation(
      async (input: { body: { content?: string; operation: string; path: string } }) => {
        if (input.body.operation !== 'upsert_text') {
          const nextDetail = createSkillDetail({
            updated_at: 1784638490,
          })
          mocks.skillDetail = {
            ...nextDetail,
            files: mocks.skillDetail?.files ?? nextDetail.files,
          }
          return mocks.skillDetail
        }

        const nextDetail = createSkillDetail({
          display_name: input.body.content?.includes('display-name: 333333333')
            ? '333333333'
            : 'Untitled skill',
          updated_at: 1784638490,
        })
        const nextFiles = nextDetail.files ?? []
        nextFiles[0] = {
          ...nextFiles[0]!,
          content: input.body.content ?? '',
        }
        nextDetail.files = nextFiles
        mocks.skillDetail = nextDetail
        return nextDetail
      },
    )
    mocks.skillMetadataMutationFn.mockImplementation(
      async (input: { body: { display_name?: string } }) => {
        const nextDetail = createSkillDetail({
          display_name: input.body.display_name ?? 'Untitled skill',
          updated_at: 1784638491,
        })
        mocks.skillDetail = {
          ...nextDetail,
          files: mocks.skillDetail?.files ?? nextDetail.files,
        }
        return nextDetail
      },
    )
    mocks.publishSkillMutationFn.mockResolvedValue({
      id: 'version-2',
      version_number: 2,
      version_name: '',
      publish_note: '',
      hash_code: 'hash-code',
      archive_size: 180,
      published_by: 'user-1',
      published_by_name: 'Fate',
      created_at: 1784638492,
      is_latest: true,
    })
    mocks.restoreSkillMutationFn.mockResolvedValue({})
    mocks.versionPatchMutationFn.mockResolvedValue({})
    mocks.versionDeleteMutationFn.mockResolvedValue({})
    mocks.sendSkillAssistMessage.mockResolvedValue(undefined)
    mocks.uploadSkillFile.mockResolvedValue({
      id: 'tool-file-1',
      name: 'guide.md',
      mime_type: 'text/markdown',
      size: 10,
    })
  })

  it('saves the live display name into SKILL.md before publishing', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const displayNameInput = await screen.findByDisplayValue('Untitled skill')
    await user.clear(displayNameInput)
    await user.type(displayNameInput, '333333333')
    await user.click(screen.getByRole('button', { name: 'agentV2.skillManagement.detail.publish' }))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalled()
    })
    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          content: expect.stringContaining('display-name: 333333333'),
          operation: 'upsert_text',
          path: 'SKILL.md',
        }),
      }),
      expect.anything(),
    )
    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })
  })

  it('adds custom metadata from the value field Enter key and saves it on publish', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.detail.addMetadata',
      }),
    )
    await user.type(
      screen.getByPlaceholderText('agentV2.skillManagement.detail.metadataKey'),
      'owner',
    )
    await user.type(
      screen.getByPlaceholderText('agentV2.skillManagement.detail.metadataValue'),
      'support{Enter}',
    )
    expect(await screen.findByText('owner')).toBeInTheDocument()
    expect(screen.getByText('support')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'agentV2.skillManagement.detail.publish' }))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            content: expect.stringContaining('  owner: support'),
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('sends uploaded Skill Builder attachments without requiring typed text', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('agentV2.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    expect(await screen.findByText('guide.md')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.skillManagement.detail.builder.send',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: 'skill-1',
          message: 'agentV2.skillManagement.detail.builder.attachmentOnlyMessage',
          attachments: [
            {
              mime_type: 'text/markdown',
              name: 'guide.md',
              size: 10,
              tool_file_id: 'tool-file-1',
            },
          ],
        }),
      )
    })
  })

  it('blocks Skill Builder sends when no model is selected or available', async () => {
    const user = userEvent.setup()
    mocks.defaultTextGenerationModel = undefined
    mocks.textGenerationModelList = []

    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'agentV2.skillManagement.detail.builder.placeholder',
    )
    const sendButton = screen.getByRole('button', {
      name: 'agentV2.skillManagement.detail.builder.send',
    })
    const suggestion = screen.getByRole('button', {
      name: 'agentV2.skillManagement.detail.builder.exampleIssueTriage',
    })

    expect(sendButton).toBeDisabled()
    expect(suggestion).toBeDisabled()

    await user.type(promptInput, 'Create a support triage skill{Enter}')

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(sendButton).toBeDisabled()
  })

  it('rejects image attachments in Skill Builder before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { container } = renderSkillDetailPage()

    await screen.findByText('agentV2.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['image'], 'image.png', {
        type: 'image/png',
      }),
    )

    expect(mocks.uploadSkillFile).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'agentV2.skillManagement.detail.builder.attachUnsupported',
    )
  })

  it('shows a publish confirmation for referenced skills before publishing updates', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({ reference_count: 1 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: [createAgentReference()],
      }),
    }))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'agentV2.skillManagement.detail.publish' }),
    )

    expect(
      await screen.findByText('agentV2.skillManagement.detail.publishReferencesTitle'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Support Agent')).toBeInTheDocument()
    expect(mocks.publishSkillMutationFn).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: 'agentV2.skillManagement.detail.publishUpdate' }),
    )

    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })
  })

  it('renders selected version files in read-only mode and restores that version', async () => {
    const user = userEvent.setup()
    const version = createSkillVersion({
      id: 'version-1',
      version_name: 'Rollback target',
    })
    mocks.skillVersionsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-versions', options],
      queryFn: async () => ({
        data: [version],
      }),
    }))
    mocks.skillVersionDetailQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-version-detail', options],
      queryFn: async () => ({
        ...version,
        files: [
          {
            id: 'version-file-1',
            path: 'SKILL.md',
            kind: 'file',
            storage: 'text',
            mime_type: 'text/markdown',
            content:
              '---\nname: github-actions-failure-debugging\ndescription: Old description.\nmetadata:\n  display-name: Rollback skill\n---\n# Rollback instructions\n',
            tool_file_id: null,
            size: 140,
            hash: 'version-hash-1',
          },
        ],
      }),
    }))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'agentV2.skillManagement.detail.versionHistory' }),
    )
    await user.click(await screen.findByRole('button', { name: /Rollback target/ }))

    expect(await screen.findByText(/Rollback instructions/)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'agentV2.skillManagement.detail.restoreVersion' }),
    )

    await waitFor(() => {
      expect(mocks.restoreSkillMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            version_id: 'version-1',
            version_name: 'Rollback target',
          },
        }),
        expect.anything(),
      )
    })
  })

  it('inserts a reference file from source editor slash picker', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'docs/guide.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# Guide',
          tool_file_id: null,
          size: 7,
          hash: 'hash-2',
        },
      ],
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('agentV2.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}{Enter}')

    await waitFor(() => {
      expect(sourceEditor.value).toContain('[guide.md](<docs/guide.md>)')
    })
  })

  it('sends suggestion chips as Builder messages and blocks concurrent sends', async () => {
    const user = userEvent.setup()
    mocks.sendSkillAssistMessage.mockImplementation(() => new Promise<void>(() => undefined))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'agentV2.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'agentV2.skillManagement.detail.builder.exampleIssueTriage',
        }),
      )
    })
    expect(
      await screen.findByPlaceholderText(
        'agentV2.skillManagement.detail.builder.modifyPlaceholder',
      ),
    ).toBeDisabled()

    await user.click(
      screen.getByRole('button', {
        name: 'agentV2.skillManagement.detail.builder.followUpDisplayName',
      }),
    )

    expect(mocks.sendSkillAssistMessage).toHaveBeenCalledTimes(1)
  })

  it('creates a folder from the root file menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('agentV2.skillManagement.detail.createFolderMenu'))
    const dialog = await screen.findByRole('dialog')

    await user.clear(within(dialog).getByDisplayValue('new-folder'))
    await user.type(within(dialog).getByRole('textbox'), 'references')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: 1784638487,
            operation: 'mkdir',
            path: 'references',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('deletes a file through the file tree action menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'SKILL.md')
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: 1784638487,
            operation: 'delete',
            path: 'SKILL.md',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('renames a version title and publish note from the version menu', async () => {
    const user = userEvent.setup()
    const version = createSkillVersion({
      id: 'version-1',
      publish_note: 'Initial note',
      version_name: 'Initial version',
    })
    mocks.skillVersionsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-versions', options],
      queryFn: async () => ({
        data: [version],
      }),
    }))
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'agentV2.skillManagement.detail.versionHistory' }),
    )
    await openVersionRowActions(user, 'Initial version')
    await user.click(await screen.findByText('agentV2.skillManagement.detail.nameThisVersion'))
    const dialog = await screen.findByRole('dialog')
    const [titleInput, noteInput] = within(dialog).getAllByRole('textbox')
    if (!titleInput || !noteInput) throw new Error('version info inputs not found')

    await user.clear(titleInput)
    await user.type(titleInput, 'Named version')
    await user.clear(noteInput)
    await user.type(noteInput, 'Release note')
    await user.click(
      within(dialog).getByRole('button', { name: 'agentV2.skillManagement.detail.publish' }),
    )

    await waitFor(() => {
      expect(mocks.versionPatchMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            publish_note: 'Release note',
            version_name: 'Named version',
          },
          params: {
            skill_id: 'skill-1',
            version_id: 'version-1',
          },
        }),
        expect.anything(),
      )
    })
  })

  it('deletes a non-latest version from the version menu', async () => {
    const user = userEvent.setup()
    const version = createSkillVersion({
      id: 'version-1',
      is_latest: false,
      version_name: 'Old version',
    })
    mocks.skillVersionsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-versions', options],
      queryFn: async () => ({
        data: [version],
      }),
    }))
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'agentV2.skillManagement.detail.versionHistory' }),
    )
    await openVersionRowActions(user, 'Old version')
    await user.click(await screen.findByText('common.operation.delete'))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'common.operation.delete' }))

    await waitFor(() => {
      expect(mocks.versionDeleteMutationFn).toHaveBeenCalledWith(
        {
          params: {
            skill_id: 'skill-1',
            version_id: 'version-1',
          },
        },
        expect.anything(),
      )
    })
  })
})
