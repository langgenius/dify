import type {
  SkillDetailResponse,
  SkillReferenceResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { vi } from 'vite-plus/test'
import { SkillDetailPage } from '../detail/page'

export const primaryModifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }

const mocks = vi.hoisted(() => ({
  deleteSkillMutationFn: vi.fn(),
  copyToClipboard: vi.fn(),
  downloadBlob: vi.fn(),
  duplicateSkillMutationFn: vi.fn(),
  fetchSkillArchiveBlob: vi.fn(),
  fetchSkillFileBlob: vi.fn(),
  checkDraftFilesMutationFn: vi.fn(),
  publishSkillMutationFn: vi.fn(),
  publishSkillMutationOptions: vi.fn(),
  routerPush: vi.fn(),
  restoreSkillMutationFn: vi.fn(),
  saveDraftFileMutationFn: vi.fn(),
  sendSkillAssistMessage: vi.fn(),
  defaultTextGenerationModel: undefined as
    | { provider: { provider: string }; model: string }
    | undefined,
  skillDetail: undefined as SkillDetailResponse | undefined,
  skillDetailGetFn: vi.fn(),
  skillDetailKey: vi.fn((_options: unknown): unknown[] => ['skill-detail']),
  skillDetailQueryOptions: vi.fn((_options: unknown) => ({})),
  agentSkillBindingsKey: vi.fn((_options: unknown): unknown[] => ['agent-skill-bindings']),
  skillListKey: vi.fn((_options: unknown): unknown[] => ['skills']),
  skillTags: [] as { count: number; tag: string }[],
  skillMetadataMutationFn: vi.fn(),
  skillReferencesQueryOptions: vi.fn((_options: unknown) => ({})),
  skillTagsKey: vi.fn((_options: unknown): unknown[] => ['skill-tags']),
  skillTagsQueryOptions: vi.fn((_options: unknown) => ({})),
  skillVersionsKey: vi.fn((_options: unknown): unknown[] => ['skill-versions']),
  skillVersionsQueryOptions: vi.fn((_options: unknown) => ({})),
  skillVersionDetailQueryOptions: vi.fn((_options: unknown) => ({})),
  textGenerationModelList: [] as {
    provider: string
    status: string
    models: { model: string; status: string }[]
  }[],
  toastError: vi.fn(),
  toastInfo: vi.fn(),
  toastSuccess: vi.fn(),
  uploadSkillFile: vi.fn(),
  versionDeleteMutationFn: vi.fn(),
  versionPatchMutationFn: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mocks.toastError,
    info: mocks.toastInfo,
    success: mocks.toastSuccess,
  },
}))

vi.mock('copy-to-clipboard', () => ({
  default: mocks.copyToClipboard,
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({
    content,
    customComponents,
  }: {
    content: string
    customComponents?: {
      a?: (props: { children: string; href: string }) => ReactNode
    }
  }) => {
    const reference = content.match(/\[([^\]]+)\]\(<([^>\n]+)>\)/)
    if (reference && customComponents?.a) {
      return <div>{customComponents.a({ children: reference[1]!, href: reference[2]! })}</div>
    }

    return <div>{content}</div>
  },
}))

vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ icon }: { icon?: string }) => <span>{icon}</span>,
}))

vi.mock('@/app/components/main-nav/components/account-section', () => ({
  default: ({ compact = false }: { compact?: boolean }) => (
    <button type="button" aria-label={compact ? 'compact-account-section' : 'account-section'}>
      Current account
    </button>
  ),
}))

vi.mock('@/app/components/main-nav/components/help-menu', () => ({
  default: () => (
    <button type="button" aria-label="help-menu">
      Help
    </button>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({
    data: mocks.defaultTextGenerationModel,
  }),
  useModelList: () => ({
    data: mocks.textGenerationModelList,
    isLoading: false,
  }),
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    currentProvider: mocks.textGenerationModelList[0],
    currentModel: mocks.textGenerationModelList[0]?.models[0],
    activeTextGenerationModelList: mocks.textGenerationModelList,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  ModelSelector: () => <button type="button">model-settings</button>,
  SplitModelSelector: () => <button type="button">model-settings</button>,
}))

vi.mock('@/service/use-common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-common')>()),
  useModelParameterRules: () => ({
    data: { data: [] },
    isLoading: false,
  }),
}))

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

vi.mock('@/features/tag-management/components/tag-management-modal', () => ({
  TagManagementModal: ({ show }: { show: boolean }) =>
    show ? <div role="dialog">common.tag.manageTags</div> : null,
}))

vi.mock('@/next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mocks.routerPush,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        skills: {
          bySkillId: {
            get: mocks.skillDetailGetFn,
          },
        },
      },
    },
  },
  consoleQuery: {
    workspaces: {
      current: {
        agents: {
          byAgentId: {
            skills: {
              get: {
                key: mocks.agentSkillBindingsKey,
              },
            },
          },
        },
        skills: {
          get: {
            key: mocks.skillListKey,
          },
          tags: {
            get: {
              key: mocks.skillTagsKey,
              queryOptions: mocks.skillTagsQueryOptions,
            },
          },
          bySkillId: {
            delete: {
              mutationOptions: () => ({ mutationFn: mocks.deleteSkillMutationFn }),
            },
            duplicate: {
              post: {
                mutationOptions: () => ({ mutationFn: mocks.duplicateSkillMutationFn }),
              },
            },
            get: {
              key: mocks.skillDetailKey,
              queryOptions: mocks.skillDetailQueryOptions,
            },
            patch: {
              mutationOptions: () => ({ mutationFn: mocks.skillMetadataMutationFn }),
            },
            publish: {
              post: {
                mutationOptions: (options?: unknown) => {
                  mocks.publishSkillMutationOptions(options)
                  return { mutationFn: mocks.publishSkillMutationFn }
                },
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
              check: {
                post: {
                  mutationOptions: () => ({ mutationFn: mocks.checkDraftFilesMutationFn }),
                },
              },
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

vi.mock('../permissions', () => ({
  useSkillPermissions: () => ({ canDelete: true, canEdit: true, canPublish: true }),
}))

vi.mock('../client', () => ({
  fetchSkillArchiveBlob: mocks.fetchSkillArchiveBlob,
  fetchSkillFileBlob: mocks.fetchSkillFileBlob,
  sendSkillAssistMessage: mocks.sendSkillAssistMessage,
  uploadSkillFile: mocks.uploadSkillFile,
}))

export function createSkillDetail(
  overrides: Partial<SkillDetailResponse> = {},
): SkillDetailResponse {
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
    latest_published_version_number: 1,
    latest_published_at: 1784638400,
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

export function createDefaultSkillDraftDetail(overrides: Partial<SkillDetailResponse> = {}) {
  return createSkillDetail({
    name: 'untitled-skill-74d8b044',
    display_name: 'Untitled skill',
    description: 'Describe what this Skill does and when an Agent should use it.',
    latest_published_version_id: null,
    files: [
      {
        id: 'file-1',
        path: 'SKILL.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content:
          '---\nname: untitled-skill-74d8b044\ndescription: Describe what this Skill does and when an Agent should use it.\nmetadata:\n  display-name: Untitled skill\n---\n# Untitled skill\n\nDescribe what this Skill does, when an Agent should use it, and any step-by-step instructions it must follow.\n',
        tool_file_id: null,
        size: 248,
        hash: 'hash-1',
      },
    ],
    ...overrides,
  })
}

export function createFileTabSkillDetail() {
  return createSkillDetail({
    files: [
      ...createSkillDetail().files!,
      {
        id: 'file-readme',
        path: 'README.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content: '# README',
        tool_file_id: null,
        size: 8,
        hash: 'hash-readme',
      },
      {
        id: 'file-prompt',
        path: 'prompt.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content: '# Prompt',
        tool_file_id: null,
        size: 8,
        hash: 'hash-prompt',
      },
      {
        id: 'file-notes',
        path: 'notes.txt',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/plain',
        content: 'Notes',
        tool_file_id: null,
        size: 5,
        hash: 'hash-notes',
      },
    ],
  })
}

export function createReferencePickerSkillDetail() {
  return createSkillDetail({
    files: [
      ...createSkillDetail().files!,
      {
        id: 'file-readme',
        path: 'README.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content: '# README',
        tool_file_id: null,
        size: 8,
        hash: 'hash-readme',
      },
      {
        id: 'file-guide',
        path: 'docs/guide.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content: '# Guide',
        tool_file_id: null,
        size: 7,
        hash: 'hash-guide',
      },
      {
        id: 'file-reference',
        path: 'docs/reference.md',
        kind: 'file',
        storage: 'text',
        mime_type: 'text/markdown',
        content: '# Reference',
        tool_file_id: null,
        size: 11,
        hash: 'hash-reference',
      },
    ],
  })
}

export function createSkillVersion(
  overrides: Partial<SkillVersionResponse> = {},
): SkillVersionResponse {
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

export function createAgentReference(
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

export function renderSkillDetailPage({
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  }),
  strict = false,
}: {
  queryClient?: QueryClient
  strict?: boolean
} = {}) {
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        {strict ? (
          <StrictMode>
            <SkillDetailPage skillId="skill-1" />
          </StrictMode>
        ) : (
          <SkillDetailPage skillId="skill-1" />
        )}
      </QueryClientProvider>,
    ),
    queryClient,
  }
}

export function getBuilderAttachmentInput(container: HTMLElement) {
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
  return inputs.at(-1) ?? null
}

export function getSourceEditor() {
  const editors = screen.getAllByRole('textbox')
  const sourceEditor = editors.find(
    (editor): editor is HTMLTextAreaElement =>
      editor instanceof HTMLTextAreaElement &&
      editor.value.includes('name: github-actions-failure-debugging'),
  )

  if (!sourceEditor) throw new Error('source editor not found')

  return sourceEditor
}

export function getLiveMarkdownEditor() {
  const liveEditor = screen
    .getAllByRole('textbox')
    .find(
      (editor): editor is HTMLDivElement =>
        editor instanceof HTMLDivElement && editor.isContentEditable,
    )

  if (!liveEditor) throw new Error('live markdown editor not found')

  return liveEditor
}

export function placeCaretAtEnd(element: HTMLElement) {
  const selection = element.ownerDocument.getSelection()
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function getFileTreeItem(path: string) {
  const fileButton = document.querySelector(`[title="${path}"]`)
  const treeItem = fileButton?.closest('[data-skill-file-tree-item]')
  if (!(treeItem instanceof HTMLElement)) throw new Error(`file tree item not found: ${path}`)

  return treeItem
}

export function getReferencePicker() {
  const picker = document.querySelector<HTMLElement>('div.fixed.z-50')
  if (!picker) throw new Error('reference picker not found')

  return picker
}

export function getReferencePickerButton(name: string | RegExp) {
  return within(getReferencePicker()).getByRole('button', { name })
}

export function preserveDraftFilesOnSave() {
  mocks.saveDraftFileMutationFn.mockImplementation(
    async (input: { body: { content?: string; operation: string; path: string } }) => {
      const currentDetail = mocks.skillDetail ?? createSkillDetail()
      const nextFiles =
        currentDetail.files?.map((file) =>
          file.path === input.body.path
            ? {
                ...file,
                content: input.body.content ?? file.content,
                hash: `${file.hash ?? 'hash'}-saved`,
              }
            : file,
        ) ?? []
      mocks.skillDetail = {
        ...currentDetail,
        files: nextFiles,
        updated_at: 1784638490,
      }

      return mocks.skillDetail
    },
  )
}

export function getFileTreeButton(path: string) {
  const fileButton = document.querySelector(`[title="${path}"]`)
  if (!(fileButton instanceof HTMLButtonElement)) throw new Error(`file button not found: ${path}`)

  return fileButton
}

export function getFileTreeContextRegion() {
  const region = document.querySelector('[data-skill-file-tree-context-region]')
  if (!(region instanceof HTMLElement)) throw new Error('file tree context region not found')

  return region
}

export function getFileTabButton(path: string) {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(`button[title="${path}"]`),
  ).find((candidate) => !candidate.closest('[data-skill-file-tree-item]'))
  if (!button) throw new Error(`file tab not found: ${path}`)

  return button
}

export function createDataTransfer(files: File[] = []) {
  const data = new Map<string, string>()
  const types = files.length > 0 ? ['Files'] : []
  const setDragImage = vi.fn()

  return {
    dataTransfer: {
      dropEffect: 'none',
      effectAllowed: 'uninitialized',
      files,
      getData: (type: string) => data.get(type) ?? '',
      setData: (type: string, value: string) => {
        data.set(type, value)
        if (!types.includes(type)) types.push(type)
      },
      setDragImage,
      types,
    } as unknown as DataTransfer,
    setDragImage,
  }
}

export async function openFileTreeActions(user: ReturnType<typeof userEvent.setup>, path: string) {
  const treeItem = getFileTreeItem(path)
  await user.click(within(treeItem).getByRole('button', { name: 'common.operation.more' }))
}

export async function openRootCreateMenu(user: ReturnType<typeof userEvent.setup>) {
  const triggers = Array.from(document.querySelectorAll('aside .i-ri-add-line'))
    .map((icon) => icon.closest('button'))
    .filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement)
  const trigger = triggers.at(-1)
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('root create menu trigger not found')

  await user.click(trigger)
}

export async function confirmUploadReview() {
  const uploadButton = await screen.findByRole('button', { name: /uploadFilesButton/ })
  fireEvent.click(uploadButton)
}

export async function openVersionRowActions(
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

export function getMocks() {
  return mocks
}

export function resetDetailPageFixture() {
  vi.useRealTimers()
  vi.resetAllMocks()
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
  mocks.skillDetailGetFn.mockImplementation(async () => mocks.skillDetail)
  mocks.skillDetailKey.mockImplementation((options) => ['skill-detail', options])
  mocks.agentSkillBindingsKey.mockImplementation((options) => ['agent-skill-bindings', options])
  mocks.skillVersionsKey.mockImplementation((options) => ['skill-versions', options])
  mocks.skillListKey.mockImplementation((options) => ['skills', options])
  mocks.skillTags = [
    { count: 3, tag: 'Search' },
    { count: 2, tag: 'Productivity' },
    { count: 1, tag: 'Utilities' },
  ]
  mocks.skillTagsKey.mockImplementation((options) => ['skill-tags', options])
  mocks.skillTagsQueryOptions.mockImplementation(() => ({
    queryKey: ['skill-tags'],
    queryFn: async () => ({
      data: [],
    }),
  }))
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
  mocks.skillTagsQueryOptions.mockImplementation(() => ({
    queryKey: ['skill-tags'],
    queryFn: async () => ({
      data: mocks.skillTags,
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
    async (input: { body: { display_name?: string; tags?: string[] } }) => {
      const nextDetail = createSkillDetail({
        display_name: input.body.display_name ?? 'Untitled skill',
        tags: input.body.tags ?? mocks.skillDetail?.tags ?? [],
        updated_at: 1784638491,
      })
      mocks.skillDetail = {
        ...nextDetail,
        files: mocks.skillDetail?.files ?? nextDetail.files,
      }
      return nextDetail
    },
  )
  mocks.publishSkillMutationFn.mockImplementation(async () => {
    const version = {
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
    }
    mocks.skillDetail = mocks.skillDetail
      ? {
          ...mocks.skillDetail,
          latest_published_at: version.created_at,
          latest_published_version_id: version.id,
          latest_published_version_number: version.version_number,
        }
      : mocks.skillDetail
    return version
  })
  mocks.restoreSkillMutationFn.mockResolvedValue({})
  mocks.versionPatchMutationFn.mockResolvedValue({})
  mocks.versionDeleteMutationFn.mockResolvedValue({})
  mocks.sendSkillAssistMessage.mockResolvedValue(undefined)
  mocks.checkDraftFilesMutationFn.mockImplementation(
    async (input: {
      body: {
        files?: Array<{
          filename: string
          mime_type?: string | null
          path?: string | null
          size: number
        }>
      }
    }) => ({
      data: Object.fromEntries(
        (input.body.files ?? []).map((file) => [
          file.filename,
          {
            errors: [],
            extension: file.filename.includes('.') ? `.${file.filename.split('.').at(-1)}` : '',
            filename: file.filename,
            mime_type: file.mime_type ?? 'application/octet-stream',
            path: file.path ?? file.filename,
            size: file.size,
          },
        ]),
      ),
    }),
  )
  mocks.uploadSkillFile.mockResolvedValue({
    id: 'tool-file-1',
    name: 'guide.md',
    mime_type: 'text/markdown',
    size: 10,
  })
}
