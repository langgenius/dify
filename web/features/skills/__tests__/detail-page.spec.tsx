import type {
  SkillDetailResponse,
  SkillReferenceResponse,
  SkillVersionResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { toast } from '@langgenius/dify-ui/toast'
import { detectPlatform } from '@tanstack/react-hotkeys'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillDetailPage from '../detail-page'

const primaryModifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }

const mocks = vi.hoisted(() => ({
  deleteSkillMutationFn: vi.fn(),
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

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
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
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: () => <button type="button">model-settings</button>,
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
  useParams: () => ({
    skillId: 'skill-1',
  }),
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

function createDefaultSkillDraftDetail(overrides: Partial<SkillDetailResponse> = {}) {
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

function createFileTabSkillDetail() {
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

function createReferencePickerSkillDetail() {
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

function renderSkillDetailPage({ strict = false }: { strict?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        {strict ? (
          <StrictMode>
            <SkillDetailPage />
          </StrictMode>
        ) : (
          <SkillDetailPage />
        )}
      </QueryClientProvider>,
    ),
    queryClient,
  }
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

function getLiveMarkdownEditor() {
  const liveEditor = screen
    .getAllByRole('textbox')
    .find(
      (editor): editor is HTMLDivElement =>
        editor instanceof HTMLDivElement && editor.isContentEditable,
    )

  if (!liveEditor) throw new Error('live markdown editor not found')

  return liveEditor
}

function placeCaretAtEnd(element: HTMLElement) {
  const selection = element.ownerDocument.getSelection()
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function getFileTreeItem(path: string) {
  const fileButton = document.querySelector(`[title="${path}"]`)
  const treeItem = fileButton?.closest('[data-skill-file-tree-item]')
  if (!(treeItem instanceof HTMLElement)) throw new Error(`file tree item not found: ${path}`)

  return treeItem
}

function getReferencePicker() {
  const picker = document.querySelector<HTMLElement>('div.fixed.z-50')
  if (!picker) throw new Error('reference picker not found')

  return picker
}

function getReferencePickerButton(name: string | RegExp) {
  return within(getReferencePicker()).getByRole('button', { name })
}

function preserveDraftFilesOnSave() {
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

function getFileTreeButton(path: string) {
  const fileButton = document.querySelector(`[title="${path}"]`)
  if (!(fileButton instanceof HTMLButtonElement)) throw new Error(`file button not found: ${path}`)

  return fileButton
}

function getFileTreeContextRegion() {
  const region = document.querySelector('[data-skill-file-tree-context-region]')
  if (!(region instanceof HTMLElement)) throw new Error('file tree context region not found')

  return region
}

function getFileTabButton(path: string) {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(`button[title="${path}"]`),
  ).find((candidate) => !candidate.closest('[data-skill-file-tree-item]'))
  if (!button) throw new Error(`file tab not found: ${path}`)

  return button
}

function createDataTransfer(files: File[] = []) {
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

async function confirmUploadReview() {
  const uploadButton = await screen.findByRole('button', { name: /uploadFilesButton/ })
  fireEvent.click(uploadButton)
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
    mocks.skillDetailGetFn.mockImplementation(async () => mocks.skillDetail)
    mocks.skillDetailKey.mockImplementation((options) => ['skill-detail', options])
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
            updated_at: version.created_at,
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
  })

  it('matches the Figma Skill sidebar navigation structure and spacing', async () => {
    renderSkillDetailPage()

    const sidebar = await screen.findByTestId('skill-detail-sidebar')
    const sidebarShell = screen.getByTestId('skill-detail-sidebar-shell')
    const header = screen.getByTestId('skill-detail-sidebar-header')

    expect(sidebarShell).toHaveClass('bg-background-body', 'p-1')
    expect(sidebar).toHaveClass('rounded-lg', 'bg-components-panel-bg')
    expect(sidebar).toHaveStyle({ width: '240px' })
    expect(header).toHaveClass('h-12', 'py-2', 'pr-2', 'pl-1')
    expect(header.querySelector('.i-ri-arrow-left-s-line')).toBeInTheDocument()
    expect(header.querySelector('.i-custom-vender-main-nav-app-home')).toBeInTheDocument()
    expect(header).toHaveTextContent('SKILLS')
    const skillsLink = screen.getByRole('link', { name: 'SKILLS' })
    expect(skillsLink).toHaveAttribute('href', '/skills')
    expect(skillsLink).toHaveClass('shrink-0')
    expect(skillsLink).not.toHaveClass('flex-1')
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.searchFiles',
      }),
    ).toHaveClass('size-8', 'rounded-[10px]')
    expect(document.querySelector('.i-custom-vender-main-nav-skill')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'account-section' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'help-menu' })).toBeInTheDocument()
  })

  it('opens the inline tag selector with workspace tag options', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const addTagButton = await screen.findByRole('combobox', {
      name: 'skill.skillManagement.detail.addTag',
    })
    await user.click(addTagButton)

    expect(
      await screen.findByRole('combobox', {
        name: 'common.tag.selectorPlaceholder',
      }),
    ).toHaveFocus()
    expect(screen.getByRole('option', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Productivity' })).toBeInTheDocument()
    expect(
      screen
        .getByRole('button', { name: 'common.tag.manageTags' })
        .querySelector('.i-custom-vender-line-financeAndECommerce-tag-01'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    ).not.toBeInTheDocument()
  })

  it('saves selected workspace tags when the selector closes', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.click(await screen.findByRole('option', { name: 'Search' }))
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            expected_updated_at: 1784638487,
            tags: ['Search'],
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('removes a selected tag when it is unchecked and the selector closes', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      tags: ['Search', 'Productivity'],
    })
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.click(await screen.findByRole('option', { name: 'Search' }))
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tags: ['Productivity'],
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('renders an unmatched search as a create action instead of a tag checkbox', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.type(
      await screen.findByRole('combobox', {
        name: 'common.tag.selectorPlaceholder',
      }),
      'BrandNew',
    )

    expect(
      await screen.findByRole('option', {
        name: "common.tag.create 'BrandNew'",
      }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'BrandNew' })).not.toBeInTheDocument()
  })

  it('creates and binds an unmatched tag when the create action is selected', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.type(
      await screen.findByRole('combobox', {
        name: 'common.tag.selectorPlaceholder',
      }),
      'BrandNew',
    )
    await user.click(
      await screen.findByRole('option', {
        name: "common.tag.create 'BrandNew'",
      }),
    )
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tags: ['BrandNew'],
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('shows an added tag only after the metadata request finishes', async () => {
    const user = userEvent.setup()
    let resolveMutation: ((detail: SkillDetailResponse) => void) | undefined
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    mocks.skillMetadataMutationFn.mockImplementation(
      () =>
        new Promise<SkillDetailResponse>((resolve) => {
          resolveMutation = resolve
        }),
    )
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.click(await screen.findByRole('option', { name: 'Search' }))
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    expect(screen.queryByText('Search')).not.toBeInTheDocument()

    await act(async () => {
      const nextDetail = createSkillDetail({
        tags: ['Search'],
        updated_at: 1784638491,
      })
      mocks.skillDetail = nextDetail
      resolveMutation?.(nextDetail)
    })

    expect(await screen.findByText('Search')).toBeInTheDocument()
  })

  it('opens tag management from the selector', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'common.tag.manageTags' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('common.tag.manageTags')
  })

  it('removes an existing tag from its badge action', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      tags: ['Search', 'Productivity', 'Utilities', 'Pre-sales'],
    })
    renderSkillDetailPage()

    expect(await screen.findByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Productivity')).toBeInTheDocument()
    expect(screen.getByText('Utilities')).toBeInTheDocument()
    expect(screen.getByText('Pre-sales')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.removeTag:{"tag":"Search"}',
      }),
    )

    await waitFor(() => {
      expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tags: ['Productivity', 'Utilities', 'Pre-sales'],
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('hides a removed tag only after the metadata request finishes', async () => {
    const user = userEvent.setup()
    let resolveMutation: ((detail: SkillDetailResponse) => void) | undefined
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    mocks.skillDetail = createSkillDetail({
      tags: ['Search', 'Productivity'],
    })
    mocks.skillMetadataMutationFn.mockImplementation(
      () =>
        new Promise<SkillDetailResponse>((resolve) => {
          resolveMutation = resolve
        }),
    )
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.removeTag:{"tag":"Search"}',
      }),
    )

    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Productivity')).toBeInTheDocument()

    await act(async () => {
      const nextDetail = createSkillDetail({
        tags: ['Productivity'],
        updated_at: 1784638491,
      })
      mocks.skillDetail = nextDetail
      resolveMutation?.(nextDetail)
    })

    await waitFor(() => {
      expect(screen.queryByText('Search')).not.toBeInTheDocument()
    })
  })

  it('does not render the markdown editor before external file content loads', async () => {
    mocks.fetchSkillFileBlob.mockImplementation(() => new Promise<Blob>(() => undefined))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'references/guide.md',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'text/markdown',
          content: null,
          tool_file_id: 'tool-file-guide',
          size: 128,
          hash: 'hash-2',
        },
      ],
    })
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    fireEvent.click(getFileTreeButton('references/guide.md'))

    await waitFor(() => {
      expect(mocks.fetchSkillFileBlob).toHaveBeenCalledOnce()
    })
    expect(container.querySelector('[contenteditable="true"]')).not.toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('loads external text file content into the editor', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockResolvedValue(new Blob(['# Loaded guide']))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'references/guide.md',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'text/markdown',
          content: null,
          tool_file_id: 'tool-file-guide',
          size: 128,
          hash: 'hash-2',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('references/guide.md'))

    expect(await screen.findByText('# Loaded guide')).toBeInTheDocument()
    await user.click(
      screen.getByRole('textbox', {
        name: 'skill.skillManagement.detail.referenceFiles.livePlaceholder',
      }),
    )
    await waitFor(() => {
      const editor = screen.getByRole('textbox', {
        name: 'skill.skillManagement.detail.referenceFiles.livePlaceholder',
      })
      expect(editor).toHaveAttribute('contenteditable', 'true')
      expect(editor).toHaveTextContent('# Loaded guide')
    })
    expect(mocks.fetchSkillFileBlob).toHaveBeenCalledWith({
      path: 'references/guide.md',
      skillId: 'skill-1',
      versionId: null,
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('shows Skill manifest placeholders for an empty draft', async () => {
    mocks.skillDetail = createDefaultSkillDraftDetail()

    renderSkillDetailPage()

    expect(
      await screen.findByPlaceholderText('skill.skillManagement.detail.skillNamePlaceholder'),
    ).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('skill.skillManagement.detail.skillDescriptionPlaceholder'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Describe what this Skill does, when an Agent should use it, and any step-by-step instructions it must follow.',
      ),
    ).not.toBeInTheDocument()
  })

  it('hides the empty draft marker after Builder fills only the Skill description', async () => {
    mocks.skillDetail = createDefaultSkillDraftDetail({
      description: 'Generate consistent character illustrations from a short prompt.',
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content:
            '---\nname: character-illustration\ndescription: Generate consistent character illustrations from a short prompt.\nmetadata:\n  display-name: Character illustration\n---\n\n<!-- dify-skill-empty-draft -->\n',
          tool_file_id: null,
          size: 190,
          hash: 'hash-1',
        },
      ],
    })

    renderSkillDetailPage()

    expect(
      await screen.findByDisplayValue(
        'Generate consistent character illustrations from a short prompt.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('<!-- dify-skill-empty-draft -->')).not.toBeInTheDocument()
  })

  it('treats a newly created empty Skill draft as Builder creation mode', async () => {
    mocks.skillDetail = createDefaultSkillDraftDetail({
      description: '',
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '<!-- dify-skill-empty-draft -->\n',
          tool_file_id: null,
          size: 32,
          hash: 'hash-1',
        },
      ],
    })

    renderSkillDetailPage()

    expect(
      await screen.findByText('skill.skillManagement.detail.builder.promptTitle'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.detail.builder.editIntro'),
    ).not.toBeInTheDocument()
  })

  it('moves the collapsed Skill Builder entry into the file tab header', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.close',
      }),
    )

    const openBuilderButton = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.open',
    })
    expect(openBuilderButton).toHaveClass('h-8', 'w-[133px]')
    expect(openBuilderButton.closest('main')).toBeInTheDocument()

    await user.click(openBuilderButton)
    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.close',
      }),
    ).toBeInTheDocument()
  })

  it('does not render the code editor when external file content fails to load', async () => {
    mocks.fetchSkillFileBlob.mockRejectedValue(new Error('content unavailable'))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/action.ts',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'text/typescript',
          content: null,
          tool_file_id: 'tool-file-action',
          size: 128,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    fireEvent.click(getFileTreeButton('scripts/action.ts'))

    expect(await screen.findByText('skill.skillManagement.detail.loadFailed')).toBeInTheDocument()
    expect(screen.queryByLabelText('code-editor')).not.toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('renders CSV files as a table preview', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-csv',
          path: 'references/refunds.csv',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/csv',
          content: 'Policy,Window\nStandard,7 days\nEscalated,Manual review',
          tool_file_id: null,
          size: 55,
          hash: 'hash-csv',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('references/refunds.csv'))

    expect(screen.getByRole('columnheader', { name: 'Policy' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Window' })).toBeInTheDocument()
    expect(screen.getByText('Standard')).toBeInTheDocument()
    expect(screen.getByText('7 days')).toBeInTheDocument()
    expect(screen.queryByLabelText('code-editor')).not.toBeInTheDocument()
  })

  it('shows an unsupported preview for non-previewable binary files', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-bin',
          path: 'assets/archive.bin',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'application/octet-stream',
          content: null,
          tool_file_id: 'tool-file-bin',
          size: 42,
          hash: 'hash-bin',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/archive.bin'))

    expect(screen.getByText('skill.skillManagement.detail.previewUnsupported')).toBeInTheDocument()
    expect(
      screen.getByText(
        'skill.skillManagement.detail.fileMeta:{"size":42,"type":"application/octet-stream"}',
      ),
    ).toBeInTheDocument()
    expect(mocks.fetchSkillFileBlob).not.toHaveBeenCalled()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('downloads unsupported binary files on request', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockResolvedValue(new Blob(['binary']))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-bin',
          path: 'assets/archive.bin',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'application/octet-stream',
          content: null,
          tool_file_id: 'tool-file-bin',
          size: 42,
          hash: 'hash-bin',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/archive.bin'))
    await user.click(
      screen.getByRole('button', { name: /skill\.skillManagement\.detail\.downloadFile/ }),
    )

    await waitFor(() => {
      expect(mocks.fetchSkillFileBlob).toHaveBeenCalledWith({
        download: true,
        path: 'assets/archive.bin',
        skillId: 'skill-1',
        versionId: null,
      })
    })
  })

  it('shows a toast when downloading a binary file fails', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockRejectedValue(new Error('download failed'))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-bin',
          path: 'assets/archive.bin',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'application/octet-stream',
          content: null,
          tool_file_id: 'tool-file-bin',
          size: 42,
          hash: 'hash-bin',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/archive.bin'))
    await user.click(
      screen.getByRole('button', { name: /skill\.skillManagement\.detail\.downloadFile/ }),
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.detail.loadFailed')
    })
  })

  it('renders image tool files after loading their preview blob', async () => {
    const user = userEvent.setup()
    const imageBlob = new Blob(['image'], { type: 'image/png' })
    let previewUrlIndex = 0
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:image-preview-${++previewUrlIndex}`)
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL')
    mocks.fetchSkillFileBlob.mockResolvedValue(imageBlob)
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-image',
          path: 'assets/logo.png',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'image/png',
          content: null,
          tool_file_id: 'tool-file-image',
          size: 128,
          hash: 'hash-image',
        },
      ],
    })

    const { unmount } = renderSkillDetailPage({ strict: true })

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/logo.png'))

    const preview = await screen.findByAltText('assets/logo.png')
    const activePreviewUrl = createObjectURL.mock.results.at(-1)?.value
    expect(preview).toBeInTheDocument()
    expect(preview).toHaveAttribute('src', activePreviewUrl)
    expect(revokeObjectURL).not.toHaveBeenCalledWith(activePreviewUrl)
    expect(mocks.fetchSkillFileBlob).toHaveBeenCalledWith({
      path: 'assets/logo.png',
      skillId: 'skill-1',
      versionId: null,
    })

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith(activePreviewUrl)
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
  })

  it('shows an image preview error when the tool file blob cannot be loaded', async () => {
    const user = userEvent.setup()
    mocks.fetchSkillFileBlob.mockRejectedValue(new Error('preview unavailable'))
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-image',
          path: 'assets/logo.png',
          kind: 'file',
          storage: 'tool_file',
          mime_type: 'image/png',
          content: null,
          tool_file_id: 'tool-file-image',
          size: 128,
          hash: 'hash-image',
        },
      ],
    })

    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    await user.click(getFileTreeButton('assets/logo.png'))

    expect(await screen.findByText('skill.skillManagement.detail.loadFailed')).toBeInTheDocument()
  })

  it('sends only one autosave request while the first save is pending', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockImplementation(() => new Promise(() => undefined))
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nNew instructions')

    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalled()
      },
      { timeout: 2500 },
    )

    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
  })

  it('saves dirty content once when the editor unmounts before autosave', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nNew instructions')
    unmount()

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
    })
  })

  it('reloads the latest draft before allowing autosave after a conflict', async () => {
    const user = userEvent.setup()
    const latestDetail = createSkillDetail({
      updated_at: 1784638499,
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content:
            '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n# Changed from another tab\n',
          tool_file_id: null,
          size: 180,
          hash: 'hash-2',
        },
      ],
    })

    const conflict = {
      code: 'skill_conflict',
      details: {
        current_file_hash: 'hash-2',
        current_updated_at: 1784638499,
        current_file_content: latestDetail.files?.[0]?.content ?? '',
        expected_updated_at: 1784638487,
      },
    }
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce(conflict)
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nMy tab changes')

    await waitFor(
      () => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
    expect(mocks.skillDetailGetFn).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(
        screen.getByText(/skill\.skillManagement\.detail\.saveConflictStatus/),
      ).toBeInTheDocument()
    })

    try {
      await waitFor(() => expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2), {
        timeout: 1500,
      })
    } catch {
      // Expected: conflict blocks autosave until the user edits again.
    }
    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('button', { name: 'skill.skillManagement.detail.saveConflictCancel' }),
    ).not.toBeInTheDocument()
    mocks.skillDetail = latestDetail
    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.saveConflictReload' }),
    )
    expect(getSourceEditor()).toHaveValue(latestDetail.files?.[0]?.content ?? '')

    await user.type(getSourceEditor(), '\nMy changes after loading the latest draft')

    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2)
      },
      { timeout: 2500 },
    )
    expect(mocks.saveDraftFileMutationFn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          content: expect.stringContaining('My changes after loading the latest draft'),
          expected_updated_at: latestDetail.updated_at,
        }),
      }),
    )
  }, 10000)

  it('discards live editor content when loading the latest draft after a conflict', async () => {
    const user = userEvent.setup()
    const latestDetail = createSkillDetail({
      updated_at: 1784638499,
      files: [
        {
          ...createSkillDetail().files![0]!,
          content:
            '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n# Latest content from another tab\n',
          hash: 'hash-2',
        },
      ],
    })
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce({
      code: 'skill_conflict',
      details: {
        current_file_content: latestDetail.files?.[0]?.content ?? '',
        current_updated_at: latestDetail.updated_at,
        expected_updated_at: 1784638487,
      },
    })
    renderSkillDetailPage()

    const livePreview = await screen.findByRole('textbox', {
      name: 'skill.skillManagement.detail.referenceFiles.livePlaceholder',
    })
    await user.click(livePreview)
    const liveEditor = await waitFor(() => getLiveMarkdownEditor())
    liveEditor.textContent = '# Local unsaved content'
    fireEvent.input(liveEditor)

    expect(await screen.findByRole('alertdialog', {}, { timeout: 5000 })).toBeInTheDocument()
    mocks.skillDetail = latestDetail
    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.saveConflictReload' }),
    )

    await waitFor(() => {
      const reloadedLivePreview = screen.getByRole('textbox', {
        name: 'skill.skillManagement.detail.referenceFiles.livePlaceholder',
      })
      expect(reloadedLivePreview).toHaveTextContent('Latest content from another tab')
      expect(reloadedLivePreview).not.toHaveTextContent('Local unsaved content')
    })
  }, 10000)

  it('uses conflict details from response errors without retrying autosave', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce(
      new Response(
        JSON.stringify({
          code: 'skill_conflict',
          message: 'skill has been modified by another user',
          details: {
            current_file_hash: 'hash-2',
            current_updated_at: 1784638499,
            expected_updated_at: 1784638487,
          },
        }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nMy response error changes')

    await waitFor(
      () => {
        expect(screen.getByRole('alertdialog')).toBeInTheDocument()
      },
      { timeout: 5000 },
    )
    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(
        screen.getByText(/skill\.skillManagement\.detail\.saveConflictStatus/),
      ).toBeInTheDocument()
    })

    try {
      await waitFor(() => expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2), {
        timeout: 1500,
      })
    } catch {
      // Expected: conflict blocks autosave until the user edits again.
    }
    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
  }, 10000)

  it('shows a save failure when conflict recovery cannot determine the latest timestamp', async () => {
    const user = userEvent.setup()
    const conflict = new Error('skill has been modified by another user') as Error & {
      code: string
      details: {
        current_file_hash: string
      }
    }
    conflict.code = 'skill_conflict'
    conflict.details = {
      current_file_hash: 'hash-2',
    }
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce(conflict)
    mocks.skillDetailGetFn.mockRejectedValueOnce(new Error('refresh failed'))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nMy unrecoverable conflict changes')

    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.detail.saveFailed')
      },
      { timeout: 4000 },
    )
    expect(screen.getByText(/skill\.skillManagement\.detail\.saveFailed/)).toBeInTheDocument()
  })

  it('shows a save failure for non-conflict autosave errors', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce(new Error('save failed'))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nMy failing save changes')

    await waitFor(
      () => {
        expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.detail.saveFailed')
      },
      { timeout: 4000 },
    )
    expect(screen.getByText(/skill\.skillManagement\.detail\.saveFailed/)).toBeInTheDocument()
  })

  it('does not expose display-name editing in the SKILL.md metadata editor before publishing', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    expect(await screen.findByText('name')).toBeInTheDocument()
    expect(screen.getByText('description')).toBeInTheDocument()
    expect(screen.queryByText('display-name')).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.publishUpdate' }),
    )

    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })
  })

  it('renames the skill from the sidebar title without changing SKILL.md content', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const renameButton = await screen.findByRole('button', { name: 'common.operation.rename' })
    expect(renameButton).toHaveClass('system-md-semibold', 'hover:bg-state-base-hover')

    await user.click(renameButton)
    const renameInput = screen.getByRole('textbox', { name: 'common.operation.rename' })
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveValue('Untitled skill')
    expect(renameInput).toHaveProperty('selectionStart', 0)
    expect(renameInput).toHaveProperty('selectionEnd', 'Untitled skill'.length)
    expect(renameInput).toHaveClass(
      'border-components-input-border-active',
      'bg-components-input-bg-active',
      'shadow-xs',
    )

    await user.clear(renameInput)
    await user.type(renameInput, 'Renamed skill{Enter}')

    await waitFor(() => {
      expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            display_name: 'Renamed skill',
          }),
        }),
        expect.anything(),
      )
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
    expect(mocks.skillMetadataMutationFn).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.detail.renameSkillSuccess')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.operation.rename' })).toHaveTextContent(
        'Renamed skill',
      )
    })
  })

  it('opens the sidebar More menu in the designed action order and reuses inline rename', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const moreButton = await screen.findByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
    })
    expect(moreButton).toHaveClass('mt-px', 'size-6', 'rounded-md')
    expect(moreButton.querySelector('[aria-hidden]')).toHaveClass('i-ri-more-fill', 'size-4')

    await user.click(moreButton)
    const menuItems = screen.getAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual([
      'common.operation.rename',
      'common.operation.duplicate',
      'common.operation.export',
      'common.operation.delete',
    ])
    expect(menuItems.map((item) => item.querySelector('[aria-hidden]')?.className)).toEqual([
      expect.stringContaining('i-ri-edit-line'),
      expect.stringContaining('i-ri-file-copy-2-line'),
      expect.stringContaining('i-ri-file-download-line'),
      expect.stringContaining('i-ri-delete-bin-line'),
    ])

    await user.click(screen.getByRole('menuitem', { name: 'common.operation.rename' }))
    const renameInput = screen.getByRole('textbox', { name: 'common.operation.rename' })
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveValue('Untitled skill')
  })

  it('duplicates and exports the current skill from the sidebar More menu', async () => {
    const user = userEvent.setup()
    const archive = new Blob(['archive'], { type: 'application/zip' })
    mocks.duplicateSkillMutationFn.mockResolvedValue({})
    mocks.fetchSkillArchiveBlob.mockResolvedValue(archive)
    renderSkillDetailPage()

    const moreButton = await screen.findByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
    })
    await user.click(moreButton)
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.duplicate' }))

    await waitFor(() => {
      expect(mocks.duplicateSkillMutationFn).toHaveBeenCalledWith(
        { params: { skill_id: 'skill-1' } },
        expect.anything(),
      )
    })
    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.duplicateSuccess')

    await user.click(moreButton)
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.export' }))

    await waitFor(() => {
      expect(mocks.fetchSkillArchiveBlob).toHaveBeenCalledWith('skill-1')
      expect(mocks.downloadBlob).toHaveBeenCalledWith({
        data: archive,
        fileName: 'github-actions-failure-debugging.zip',
      })
    })
  })

  it('requires the display name before deleting a referenced skill from the sidebar', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({ reference_count: 1 })
    mocks.deleteSkillMutationFn.mockResolvedValue({})
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))

    expect(
      screen.getByText('skill.skillManagement.deleteDialog.title:{"name":"Untitled skill"}'),
    ).toBeInTheDocument()
    const dialog = screen.getByRole('alertdialog')
    const confirmationInput = within(dialog).getByPlaceholderText(
      'skill.skillManagement.deleteDialog.confirmInputPlaceholder',
    )
    const confirmButton = within(dialog).getByRole('button', {
      name: 'common.operation.confirm',
    })
    expect(confirmButton).toBeDisabled()

    await user.type(confirmationInput, 'Untitled skill')
    expect(confirmButton).toBeEnabled()
    await user.click(confirmButton)

    await waitFor(() => {
      expect(mocks.deleteSkillMutationFn).toHaveBeenCalledWith(
        {
          body: { confirmation_name: 'Untitled skill' },
          params: { skill_id: 'skill-1' },
        },
        expect.anything(),
      )
      expect(mocks.routerPush).toHaveBeenCalledWith('/skills')
    })
  })

  it('keeps sidebar deletion disabled while cached references refresh', async () => {
    const user = userEvent.setup()
    let referenceRequestCount = 0
    let shouldHangReferenceRequest = false
    mocks.skillDetail = createSkillDetail({ reference_count: 0 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references-pending', options],
      queryFn: () => {
        referenceRequestCount += 1
        if (!shouldHangReferenceRequest) return Promise.resolve({ data: [] })

        return new Promise(() => {})
      },
    }))
    renderSkillDetailPage()

    const moreButton = await screen.findByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
    })
    await user.click(moreButton)
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
    let dialog = screen.getByRole('alertdialog')

    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'common.operation.delete' })).toBeEnabled()
    })
    const initialRequestCount = referenceRequestCount
    shouldHangReferenceRequest = true
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    await user.click(moreButton)
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.delete' }))
    dialog = screen.getByRole('alertdialog')

    expect(
      within(dialog).getByRole('button', {
        name: 'common.operation.delete',
      }),
    ).toBeDisabled()
    await waitFor(() => {
      expect(referenceRequestCount).toBeGreaterThan(initialRequestCount)
    })
  })

  it('does not expose mutable More actions while viewing a published version', async () => {
    mocks.skillVersionsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-versions', options],
      queryFn: async () => ({ data: [createSkillVersion()] }),
    }))
    renderSkillDetailPage()

    await userEvent
      .setup()
      .click(
        await screen.findByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
      )
    await userEvent.setup().click(await screen.findByText('Initial version'))

    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
      }),
    ).not.toBeInTheDocument()
  })

  it('keeps display-name hidden in the SKILL.md metadata editor', async () => {
    renderSkillDetailPage()

    expect(await screen.findByText('name')).toBeInTheDocument()
    expect(screen.getByText('description')).toBeInTheDocument()
    expect(screen.queryByText('display-name')).not.toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalled()
  })

  it('cancels an empty sidebar rename when the field loses focus', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(await screen.findByRole('button', { name: 'common.operation.rename' }))
    const renameInput = screen.getByRole('textbox', { name: 'common.operation.rename' })
    await user.clear(renameInput)
    await user.tab()

    expect(
      screen.queryByRole('textbox', { name: 'common.operation.rename' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.rename' })).toHaveTextContent(
      'Untitled skill',
    )
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('marks changes as published and enables publish update after new edits', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderSkillDetailPage()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    const publishButton = await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.publishUpdate',
    })
    expect(publishButton).toBeEnabled()

    await user.click(publishButton)

    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['skills', { type: 'infinite' }],
      })
    })
    await waitFor(() => {
      expect(document.body).toHaveTextContent('skill.skillManagement.detail.upToDate')
    })
    expect(publishButton).toBeDisabled()
    expect(publishButton).toHaveAccessibleName('skill.skillManagement.detail.published')

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nUpdated published instructions')

    expect(publishButton).toBeEnabled()
    expect(publishButton).toHaveAccessibleName('skill.skillManagement.detail.publishUpdate')
    expect(document.body).toHaveTextContent('skill.skillManagement.detail.unpublishedChanges')
  })

  it('adds custom metadata from the value field Enter key and saves it on publish', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.addMetadata',
      }),
    )
    await user.type(
      screen.getByPlaceholderText('skill.skillManagement.detail.metadataKey'),
      'owner',
    )
    await user.type(
      screen.getByPlaceholderText('skill.skillManagement.detail.metadataValue'),
      'support{Enter}',
    )
    expect(await screen.findByDisplayValue('owner')).toBeInTheDocument()
    expect(screen.getByDisplayValue('support')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.publishUpdate' }),
    )

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

  it('commits custom metadata on blur so another entry can be added and published', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      updated_at: 1784638400,
    })
    renderSkillDetailPage()

    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.published',
      }),
    ).toBeDisabled()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.addMetadata',
      }),
    )
    await user.type(
      screen.getByPlaceholderText('skill.skillManagement.detail.metadataKey'),
      'owner',
    )
    await user.type(
      screen.getByPlaceholderText('skill.skillManagement.detail.metadataValue'),
      'support',
    )
    await user.tab()

    expect(screen.getByRole('textbox', { name: 'owner value' })).toHaveValue('support')
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.addMetadata',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    ).toBeEnabled()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.addMetadata',
      }),
    )
    await user.type(screen.getByPlaceholderText('skill.skillManagement.detail.metadataKey'), 'team')
    await user.type(
      screen.getByPlaceholderText('skill.skillManagement.detail.metadataValue'),
      'success',
    )
    await user.tab()

    expect(screen.getByRole('textbox', { name: 'team value' })).toHaveValue('success')
    expect(screen.getByRole('textbox', { name: 'owner value' })).toHaveValue('support')
  })

  it('cancels custom metadata creation from both metadata fields', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.addMetadata',
      }),
    )
    const keyInput = screen.getByPlaceholderText('skill.skillManagement.detail.metadataKey')
    await user.type(keyInput, 'owner{Escape}')
    expect(
      screen.queryByPlaceholderText('skill.skillManagement.detail.metadataKey'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.addMetadata',
      }),
    )
    await user.type(
      screen.getByPlaceholderText('skill.skillManagement.detail.metadataValue'),
      'support{Escape}',
    )
    expect(
      screen.queryByPlaceholderText('skill.skillManagement.detail.metadataValue'),
    ).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('owner')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('support')).not.toBeInTheDocument()
  })

  it('saves edits made directly in the manifest name and description fields', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const nameInput = await screen.findByDisplayValue('github-actions-failure-debugging')
    await user.clear(nameInput)
    await user.type(nameInput, 'customer-issue-triage')
    const descriptionInput = screen.getByDisplayValue(
      'Guide for debugging failing GitHub Actions workflows.',
    )
    await user.clear(descriptionInput)
    await user.type(descriptionInput, 'Classify support issues by severity.')

    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              content: expect.stringMatching(
                /name: customer-issue-triage[\s\S]*description: Classify support issues by severity\./,
              ),
              path: 'SKILL.md',
            }),
          }),
          expect.anything(),
        )
      },
      { timeout: 2500 },
    )
  })

  it('updates and removes existing custom metadata from the manifest editor', async () => {
    const user = userEvent.setup()
    const content =
      '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n  owner: support\n---\n# GitHub Actions Failure Debugging\n'
    mocks.skillDetail = createSkillDetail({
      files: [
        {
          ...createSkillDetail().files![0]!,
          content,
          size: content.length,
        },
      ],
    })

    renderSkillDetailPage()

    const ownerValue = await screen.findByRole('textbox', { name: 'owner value' })
    await user.clear(ownerValue)
    await user.type(ownerValue, 'success')
    await user.tab()

    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              content: expect.stringContaining('  owner: success'),
              path: 'SKILL.md',
            }),
          }),
          expect.anything(),
        )
      },
      { timeout: 2500 },
    )

    await user.click(screen.getByRole('button', { name: 'Remove owner' }))

    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
          expect.objectContaining({
            body: expect.objectContaining({
              content: expect.not.stringContaining('  owner:'),
              path: 'SKILL.md',
            }),
          }),
          expect.anything(),
        )
      },
      { timeout: 2500 },
    )
  })

  it('does not render Skill metadata controls for non-SKILL markdown files', async () => {
    const user = userEvent.setup()
    const defaultFiles = createSkillDetail().files!
    mocks.skillDetail = createSkillDetail({
      files: [
        {
          id: 'file-2',
          path: 'references/refund-policy.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content:
            '---\nname: refund-policy\ndescription: Refund policy.\nmetadata:\n  display-name: Refund Policy\n---\n# 退款政策\n',
          tool_file_id: null,
          size: 109,
          hash: 'hash-2',
        },
        ...defaultFiles,
      ],
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.click(await screen.findByText('references'))
    fireEvent.click(getFileTreeButton('references/refund-policy.md'))

    await waitFor(() => {
      expect(
        screen
          .getAllByRole('textbox')
          .map((textbox) => ('value' in textbox ? String(textbox.value) : textbox.textContent))
          .join('\n'),
      ).toContain('# 退款政策')
    })
    expect(screen.queryByDisplayValue('refund-policy')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Refund policy.')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Refund Policy')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'skill.skillManagement.detail.addMetadata' }),
    ).not.toBeInTheDocument()
  })

  it('keeps line breaks typed in the live markdown editor', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content:
            '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n',
          tool_file_id: null,
          size: 148,
          hash: 'hash-1',
        },
      ],
    })

    renderSkillDetailPage()

    const textboxes = await screen.findAllByRole('textbox')
    const liveEditor = textboxes.find(
      (textbox): textbox is HTMLDivElement =>
        textbox instanceof HTMLDivElement && textbox.isContentEditable,
    )
    if (!liveEditor) throw new Error('live editor not found')

    await user.click(liveEditor)
    await user.type(liveEditor, 'First line{Enter}Second line')
    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.publishUpdate' }),
    )

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            content: expect.stringContaining('First line\nSecond line'),
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('sends uploaded Skill Builder attachments without requiring typed text', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    expect(
      await screen.findByText('skill.skillManagement.detail.builder.editIntro'),
    ).toBeInTheDocument()
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
        name: 'skill.skillManagement.detail.builder.send',
      }),
    )
    expect(await screen.findByText('guide.md')).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.detail.builder.editIntro'),
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          skillId: 'skill-1',
          message: 'skill.skillManagement.detail.builder.attachmentOnlyMessage',
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

  it('retries a Skill Builder attachment request with the original attachment', async () => {
    const user = userEvent.setup()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData }) => {
      onData?.('Used the guide.', true, {})
      onCompleted?.()
      return Promise.resolve()
    })
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()
    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    )
    await screen.findByText('Used the guide.')
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.retryResponse',
      }),
    )

    await waitFor(() => expect(mocks.sendSkillAssistMessage).toHaveBeenCalledTimes(2))
    expect(mocks.sendSkillAssistMessage.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
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

  it('removes uploaded Skill Builder attachments before sending', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
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
        name: 'skill.skillManagement.detail.builder.removeAttachment:{"name":"guide.md"}',
      }),
    )

    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    ).toBeDisabled()
  })

  it('opens the Skill Builder attachment picker from the toolbar button', async () => {
    const user = userEvent.setup()
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()
    const clickSpy = vi.spyOn(attachmentInput!, 'click')

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.attach',
      }),
    )

    expect(clickSpy).toHaveBeenCalledOnce()
  })

  it('does not send the Skill Builder prompt while an attachment is uploading', async () => {
    const user = userEvent.setup()
    mocks.uploadSkillFile.mockImplementation(() => new Promise(() => undefined))
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledOnce()
    })

    const promptInput = screen.getByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    await user.type(promptInput, 'Use the attached guide{Enter}')

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(promptInput).toHaveValue('Use the attached guide')
  })

  it('ignores an in-flight attachment after restarting Skill Builder', async () => {
    const user = userEvent.setup()
    let resolveUpload!: (file: {
      id: string
      mime_type: string
      name: string
      size: number
    }) => void
    mocks.uploadSkillFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        }),
    )
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()
    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await waitFor(() => expect(mocks.uploadSkillFile).toHaveBeenCalledOnce())
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.restart',
      }),
    )
    expect(attachmentInput).toHaveValue('')

    await act(async () => {
      resolveUpload({
        id: 'tool-file-1',
        mime_type: 'text/markdown',
        name: 'guide.md',
        size: 10,
      })
    })
    expect(screen.queryByText('guide.md')).not.toBeInTheDocument()
  })

  it('disables Skill Builder suggestions while an attachment is uploading', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.uploadSkillFile.mockImplementation(() => new Promise(() => undefined))
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['# Guide'], 'guide.md', {
        type: 'text/markdown',
      }),
    )
    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledOnce()
    })

    const suggestion = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
    })
    expect(suggestion).toBeDisabled()

    await user.click(suggestion)
    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
  })

  it('does not send the Skill Builder prompt when Enter confirms IME composition', async () => {
    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    fireEvent.change(promptInput, { target: { value: 'ni' } })
    fireEvent.compositionStart(promptInput)
    fireEvent.keyDown(promptInput, { isComposing: true, key: 'Enter' })

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(promptInput).toHaveValue('ni')
  })

  it('keeps blocking Skill Builder Enter briefly after IME composition ends', async () => {
    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    vi.useFakeTimers()
    try {
      fireEvent.change(promptInput, { target: { value: '你好' } })
      fireEvent.compositionStart(promptInput)
      fireEvent.compositionEnd(promptInput)
      fireEvent.keyDown(promptInput, { isComposing: false, key: 'Enter' })

      expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
      expect(promptInput).toHaveValue('你好')

      act(() => {
        vi.advanceTimersByTime(50)
      })
      fireEvent.keyDown(promptInput, { isComposing: false, key: 'Enter' })

      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '你好',
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the Skill Builder prompt with Enter when IME composition is inactive', async () => {
    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.modifyPlaceholder',
    )
    fireEvent.change(promptInput, { target: { value: 'Create a support triage skill' } })
    fireEvent.keyDown(promptInput, { isComposing: false, key: 'Enter' })

    expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Create a support triage skill',
      }),
    )
  })

  it('blocks Skill Builder sends when no model is selected or available', async () => {
    const user = userEvent.setup()
    mocks.defaultTextGenerationModel = undefined
    mocks.textGenerationModelList = []
    mocks.skillDetail = createDefaultSkillDraftDetail()

    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.placeholder',
    )
    const sendButton = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.send',
    })
    const suggestion = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
    })

    expect(sendButton).toBeDisabled()
    expect(suggestion).toBeDisabled()

    await user.type(promptInput, 'Create a support triage skill{Enter}')

    expect(mocks.sendSkillAssistMessage).not.toHaveBeenCalled()
    expect(sendButton).toBeDisabled()
  }, 15000)

  it('uploads image attachments in Skill Builder', async () => {
    const user = userEvent.setup({ applyAccept: false })
    mocks.uploadSkillFile.mockResolvedValue({
      id: 'tool-image-1',
      name: 'image.png',
      mime_type: 'image/png',
      size: 5,
    })
    const { container } = renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    const attachmentInput = getBuilderAttachmentInput(container)
    expect(attachmentInput).not.toBeNull()

    await user.upload(
      attachmentInput!,
      new File(['image'], 'image.png', {
        type: 'image/png',
      }),
    )

    expect(mocks.uploadSkillFile).toHaveBeenCalledWith(expect.any(File))
    expect(toast.error).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.send',
      }),
    )
    expect(await screen.findByRole('img', { name: 'image.png' })).toBeInTheDocument()
  })

  it('does not show voice input in Skill Builder', async () => {
    renderSkillDetailPage()

    await screen.findByText('skill.skillManagement.detail.builder.title')
    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.detail.builder.voice',
      }),
    ).not.toBeInTheDocument()
  })

  it('shows an error and re-enables Skill Builder input when sending fails', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockRejectedValue(new Error('builder unavailable'))

    renderSkillDetailPage()

    const promptInput = await screen.findByPlaceholderText(
      'skill.skillManagement.detail.builder.placeholder',
    )
    await user.type(promptInput, 'Create a support triage skill{Enter}')

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('builder unavailable')
    })
    expect(
      screen.getByPlaceholderText('skill.skillManagement.detail.builder.modifyPlaceholder'),
    ).toBeEnabled()
  }, 15000)

  it('shows Skill Builder completion errors returned by the assistant stream', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted }) => {
      onCompleted?.(true, 'builder stream failed')
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('builder stream failed')
    })
    expect(
      screen.getByPlaceholderText('skill.skillManagement.detail.builder.modifyPlaceholder'),
    ).toBeEnabled()
  })

  it('replaces optimistic Skill Builder replies when the assistant stream returns an error', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onData, onError }) => {
      onData?.('已创建用于客户问题分级处理的 skill 草案', true, {
        messageId: 'assistant-message',
      })
      onError?.(
        'the Skill Authoring assistant could not apply its response',
        'skill_assistant_failed',
      )
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'the Skill Authoring assistant could not apply its response',
      )
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
    const errorMessage = screen.getByText(
      'the Skill Authoring assistant could not apply its response',
    )
    expect(errorMessage).toBeInTheDocument()
    expect(errorMessage.closest('.rounded-xl')).toHaveClass(
      'border-state-destructive-border',
      'bg-state-destructive-hover',
      'text-text-destructive',
    )
    expect(screen.queryByText('已创建用于客户问题分级处理的 skill 草案')).not.toBeInTheDocument()
  })

  it('shows only the detailed backend error when publishing fails', async () => {
    const user = userEvent.setup()
    mocks.publishSkillMutationFn.mockRejectedValueOnce(
      new Error('SKILL.md frontmatter name is required'),
    )

    renderSkillDetailPage()

    expect(mocks.publishSkillMutationOptions).toHaveBeenCalledWith({
      context: { silent: true },
    })
    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('SKILL.md frontmatter name is required')
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
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
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    expect(
      await screen.findByText('skill.skillManagement.detail.publishReferencesTitle'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Support Agent')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Support Agent/ })).toHaveAttribute('target', '_blank')
    expect(mocks.publishSkillMutationFn).not.toHaveBeenCalled()

    const publishDialog = screen.getByRole('dialog', {
      name: 'skill.skillManagement.detail.publishReferencesTitle',
    })
    expect(screen.getByTestId('skill-publish-bar')).not.toBeVisible()
    expect(screen.getByTestId('skill-publish-reference-list')).not.toHaveAttribute(
      'data-scrollable',
    )
    await user.click(
      within(publishDialog).getByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })
  })

  it('checks references before publishing when the cached reference count is stale', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({ reference_count: 0 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: [
          createAgentReference({
            display_name: 'Stale Count Agent',
            name: 'stale-count-agent',
          }),
        ],
      }),
    }))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    expect(
      await screen.findByRole('dialog', {
        name: 'skill.skillManagement.detail.publishReferencesTitle',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('skill.skillManagement.detail.publishReferencesDescription:{"count":1}'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Stale Count Agent')).toBeInTheDocument()
    expect(mocks.publishSkillMutationFn).not.toHaveBeenCalled()
  })

  it('cancels publishing from the referenced skill confirmation dialog', async () => {
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
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    const publishDialog = await screen.findByRole('dialog', {
      name: 'skill.skillManagement.detail.publishReferencesTitle',
    })
    await user.click(within(publishDialog).getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', {
          name: 'skill.skillManagement.detail.publishReferencesTitle',
        }),
      ).not.toBeInTheDocument()
    })
    expect(mocks.publishSkillMutationFn).not.toHaveBeenCalled()
  })

  it('opens the sidebar references panel from the file tree footer', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({ reference_count: 1 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: [createAgentReference({ display_name: 'Sidebar Agent', name: 'sidebar-agent' })],
      }),
    }))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.referencedBy:{"count":1}',
      }),
    )

    expect(await screen.findByText('Sidebar Agent')).toBeInTheDocument()
    expect(mocks.skillReferencesQueryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          params: {
            skill_id: 'skill-1',
          },
        },
      }),
    )
  })

  it('uses the references query count when the cached sidebar reference count is stale', async () => {
    mocks.skillDetail = createSkillDetail({ reference_count: 0 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: [createAgentReference({ display_name: 'Sidebar Agent', name: 'sidebar-agent' })],
      }),
    }))

    renderSkillDetailPage()

    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.referencedBy:{"count":1}',
      }),
    ).toBeInTheDocument()
  })

  it('closes the sidebar references panel when clicking outside it', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({ reference_count: 1 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({
        data: [createAgentReference({ display_name: 'Sidebar Agent', name: 'sidebar-agent' })],
      }),
    }))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.referencedBy:{"count":1}',
      }),
    )
    expect(await screen.findByText('Sidebar Agent')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)

    await waitFor(() => {
      expect(screen.queryByText('Sidebar Agent')).not.toBeInTheDocument()
    })
  })

  it('opens files from the file tree search dialog', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
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
          id: 'file-policy',
          path: 'references/policy.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# Policy',
          tool_file_id: null,
          size: 8,
          hash: 'hash-policy',
        },
      ],
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.searchFiles' }),
    )
    await user.type(
      screen.getByRole('textbox', { name: 'skill.skillManagement.detail.searchFiles' }),
      'guide',
    )

    expect(screen.getByRole('button', { name: 'docs/guide.md' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'references/policy.md' })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')

    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"docs/guide.md"}',
      }),
    ).toBeInTheDocument()
  })

  it('opens files by clicking search results and shows the empty search state', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
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
      ],
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.searchFiles' }),
    )
    const searchInput = screen.getByRole('textbox', {
      name: 'skill.skillManagement.detail.searchFiles',
    })
    await user.type(searchInput, 'missing')
    expect(screen.getByText('skill.skillManagement.detail.noSearchResults')).toBeInTheDocument()

    await user.clear(searchInput)
    await user.type(searchInput, 'guide')
    await user.click(screen.getByRole('button', { name: 'docs/guide.md' }))

    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"docs/guide.md"}',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'skill.skillManagement.detail.searchFiles' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the file search dialog open when Enter is pressed without results', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.searchFiles' }),
    )
    const searchInput = screen.getByRole('textbox', {
      name: 'skill.skillManagement.detail.searchFiles',
    })

    await user.type(searchInput, 'not-present{Enter}')

    expect(searchInput).toBeInTheDocument()
    expect(screen.getByText('skill.skillManagement.detail.noSearchResults')).toBeInTheDocument()
  })

  it('collapses and expands the file tree sidebar', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.collapseSidebar',
      }),
    )
    expect(screen.queryByTestId('skill-detail-sidebar-header')).not.toBeInTheDocument()
    expect(screen.getByTestId('skill-detail-sidebar-shell')).toHaveClass('w-16')

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.expandSidebar',
      }),
    )
    expect(await screen.findByTestId('skill-detail-sidebar-header')).toBeInTheDocument()
  })

  it('shows the Figma floating sidebar when the collapsed rail is hovered', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.collapseSidebar',
      }),
    )
    expect(screen.queryByTestId('skill-detail-sidebar-header')).not.toBeInTheDocument()

    fireEvent.mouseEnter(screen.getByTestId('skill-detail-sidebar-shell'))

    expect(await screen.findByTestId('skill-detail-sidebar-header')).toBeInTheDocument()
    expect(screen.getByTestId('skill-detail-sidebar')).toHaveClass(
      'absolute',
      'w-60',
      'border',
      'shadow-lg',
    )
    expect(screen.getByTestId('skill-detail-sidebar')).toHaveStyle({ width: '240px' })

    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.collapseSidebar',
      }),
    )

    expect(await screen.findByTestId('skill-detail-sidebar-header')).toBeInTheDocument()
  })

  it('resizes the file tree sidebar between the Figma minimum and maximum widths', async () => {
    renderSkillDetailPage()

    const resizeHandle = await screen.findByRole('separator', {
      name: 'skill.skillManagement.detail.resizeSidebar',
    })
    const sidebar = screen.getByTestId('skill-detail-sidebar')

    expect(resizeHandle).toHaveAttribute('aria-valuemin', '240')
    expect(resizeHandle).toHaveAttribute('aria-valuemax', '420')
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')
    expect(sidebar).toHaveStyle({ width: '240px' })

    fireEvent.pointerDown(resizeHandle, { button: 0, clientX: 244 })
    fireEvent.pointerMove(document, { clientX: 600 })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '420')
    expect(sidebar).toHaveStyle({ width: '420px' })

    fireEvent.pointerMove(document, { clientX: 0 })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')
    expect(sidebar).toHaveStyle({ width: '240px' })
    fireEvent.pointerUp(document)

    fireEvent.keyDown(resizeHandle, { key: 'ArrowRight' })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '248')
    fireEvent.keyDown(resizeHandle, { key: 'End' })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '420')
    fireEvent.keyDown(resizeHandle, { key: 'Home' })
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '240')
  })

  it('scrolls the publish reference list after ten items', async () => {
    const user = userEvent.setup()
    const references = Array.from({ length: 11 }, (_, index) =>
      createAgentReference({
        agent_id: `agent-${index + 1}`,
        app_id: `app-${index + 1}`,
        display_name: `Reference ${index + 1}`,
        name: `reference-${index + 1}`,
      }),
    )
    mocks.skillDetail = createSkillDetail({ reference_count: references.length })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({ data: references }),
    }))

    renderSkillDetailPage()
    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    const referenceList = await screen.findByTestId('skill-publish-reference-list')
    expect(referenceList).not.toHaveAttribute('data-scrollable')
    expect(within(referenceList).getAllByRole('link')).toHaveLength(5)
    expect(within(referenceList).queryByText('Reference 6')).not.toBeInTheDocument()

    await user.click(
      within(referenceList).getByRole('button', {
        name: 'skill.skillManagement.detail.showMoreReferences:{"count":6}',
      }),
    )

    expect(referenceList).toHaveAttribute('data-scrollable', 'true')
    expect(referenceList).toHaveClass('max-h-[240px]', 'overflow-y-auto')
    expect(within(referenceList).getAllByRole('link')).toHaveLength(11)
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

    const { queryClient } = renderSkillDetailPage()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
    )
    await user.click(await screen.findByRole('button', { name: /Rollback target/ }))

    expect(await screen.findByText(/Rollback instructions/)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.restoreVersion' }),
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'skill.skillManagement.detail.restoreVersion',
      }),
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
    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['skills', { type: 'infinite' }],
      })
    })
  })

  it('displays an unnamed version by its per-skill sequence number', async () => {
    const user = userEvent.setup()
    const version = createSkillVersion({
      id: 'version-2',
      version_number: 2,
      version_name: '',
      publish_note: 'Release note only',
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
              '---\nname: github-actions-failure-debugging\ndescription: Old description.\n---\n# Rollback instructions\n',
            tool_file_id: null,
            size: 120,
            hash: 'version-hash-1',
          },
        ],
      }),
    }))
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
    )
    await user.click(await screen.findByRole('button', { name: /#2/ }))

    expect(await screen.findAllByText('#2')).toHaveLength(2)

    await user.click(
      screen.getByRole('button', { name: 'skill.skillManagement.detail.restoreVersion' }),
    )
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'skill.skillManagement.detail.restoreVersion',
      }),
    )

    await waitFor(() => {
      expect(mocks.restoreSkillMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            version_id: 'version-2',
            version_name: '',
          },
        }),
        expect.anything(),
      )
    })
  })

  it('matches the versions timeline interactions and omits the unused copy id action', async () => {
    const user = userEvent.setup()
    const namedVersion = createSkillVersion({
      id: 'version-1',
      is_latest: true,
      version_name: 'Named version',
    })
    const unnamedVersion = createSkillVersion({
      id: 'version-2',
      version_number: 2,
      version_name: '',
    })
    mocks.skillVersionsQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-versions', options],
      queryFn: async () => ({
        data: [namedVersion, unnamedVersion],
      }),
    }))

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
    )

    const panelTitle = await screen.findByText('skill.skillManagement.detail.versions')
    expect(panelTitle.closest('aside')).toHaveClass('w-67', 'py-1')
    expect(screen.getAllByRole('button', { current: true })).toHaveLength(1)

    await openVersionRowActions(user, '#2')
    expect(screen.queryByText('skill.skillManagement.detail.copyVersionId')).not.toBeInTheDocument()
    expect(await screen.findByRole('menu')).toHaveClass('w-[184px]')

    await user.keyboard('{Escape}')
    await user.click(
      screen.getByRole('button', {
        name: /workflow\.versionHistory\.filter\.all/,
      }),
    )
    await user.click(
      await screen.findByText('workflow.versionHistory.filter.onlyShowNamedVersions'),
    )

    expect(screen.queryByText('#2')).not.toBeInTheDocument()

    const currentDraft = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.currentDraft',
    })
    await user.click(currentDraft)
    expect(currentDraft).toHaveAttribute('aria-current', 'true')
  })

  it('inserts a reference file from source editor slash picker', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}{Enter}')

    await waitFor(() => {
      expect(sourceEditor.value).toContain('[guide.md](<docs/guide.md>)')
    })
  })

  it('navigates, filters, closes, and inserts from the source reference picker', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.click(getReferencePickerButton('docs'))
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()
    expect(getReferencePickerButton('guide.md')).toBeInTheDocument()
    await user.click(getReferencePickerButton('..'))
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
    await user.keyboard('read')
    await waitFor(() => {
      expect(within(getReferencePicker()).getByText('read')).toBeInTheDocument()
    })
    expect(getReferencePickerButton('README.md')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(
        screen.queryByText('skill.skillManagement.detail.referenceFiles.title'),
      ).not.toBeInTheDocument()
    })

    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
    await user.keyboard('/')
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)
    await user.keyboard('read')
    await user.click(getReferencePickerButton('README.md'))

    await waitFor(() => {
      expect(sourceEditor.value).toContain('[README.md](<README.md>)')
    })
  })

  it('navigates the source reference picker with arrow keys', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()

    await user.keyboard('{ArrowUp}')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(sourceEditor.value).toContain('[reference.md](<docs/reference.md>)')
    })
  })

  it('handles reference picker Enter and ArrowUp keyboard edge cases', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    const sourceEditor = getSourceEditor()
    sourceEditor.focus()
    sourceEditor.setSelectionRange(sourceEditor.value.length, sourceEditor.value.length)

    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}')
    expect(within(getReferencePicker()).getByText('docs')).toBeInTheDocument()
  })

  it('inserts a reference file from live markdown slash picker', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    const livePreview = screen
      .getAllByRole('textbox')
      .find((editor): editor is HTMLDivElement => editor instanceof HTMLDivElement)
    if (!livePreview) throw new Error('live markdown preview not found')

    await user.click(livePreview)
    const liveEditor = await waitFor(() => getLiveMarkdownEditor())
    liveEditor.focus()
    placeCaretAtEnd(liveEditor)
    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.keyboard('{ArrowRight}{Enter}')

    await waitFor(() => {
      expect(liveEditor.textContent).toContain('guide.md')
    })
  })

  it('inserts a reference from the live picker by clicking through a directory', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createReferencePickerSkillDetail()
    preserveDraftFilesOnSave()

    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    const livePreview = screen
      .getAllByRole('textbox')
      .find((editor): editor is HTMLDivElement => editor instanceof HTMLDivElement)
    if (!livePreview) throw new Error('live markdown preview not found')

    await user.click(livePreview)
    const liveEditor = await waitFor(() => getLiveMarkdownEditor())
    liveEditor.focus()
    placeCaretAtEnd(liveEditor)
    await user.keyboard('/')
    expect(
      await screen.findByText('skill.skillManagement.detail.referenceFiles.title'),
    ).toBeInTheDocument()

    await user.click(getReferencePickerButton('docs'))
    await user.keyboard('{ArrowDown}{Enter}')

    await waitFor(() => {
      expect(
        screen.queryByText('skill.skillManagement.detail.referenceFiles.title'),
      ).not.toBeInTheDocument()
    })
  })

  it('shows the full reference path on hover and opens the referenced file in an editor tab', async () => {
    const manifestContent =
      '---\nname: github-actions-failure-debugging\ndescription: Guide for debugging failing GitHub Actions workflows.\nmetadata:\n  display-name: Untitled skill\n---\n# Guide\n\nRead [guide.md](<docs/guide.md>) before continuing.\n'
    mocks.skillDetail = createSkillDetail({
      files: [
        {
          ...createSkillDetail().files![0]!,
          content: manifestContent,
          size: manifestContent.length,
        },
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

    const { container } = renderSkillDetailPage()
    const reference = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-reference-path="docs/guide.md"]')
      expect(element).toBeInTheDocument()
      return element!
    })

    expect(reference).toHaveAttribute('title', 'docs/guide.md')

    fireEvent.click(reference)
    expect(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"docs/guide.md"}',
      }),
    ).toBeInTheDocument()
  })

  it('keeps SKILL.md open and replaces the previous temporary tab on sidebar single click', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    expect(getFileTabButton('SKILL.md')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"SKILL.md"}',
      }),
    ).not.toBeInTheDocument()

    await user.click(getFileTreeButton('README.md'))
    expect(getFileTabButton('README.md').querySelector('.italic')).toBeInTheDocument()

    await user.click(getFileTreeButton('prompt.md'))
    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"README.md"}',
      }),
    ).not.toBeInTheDocument()
    expect(getFileTabButton('prompt.md').querySelector('.italic')).toBeInTheDocument()
    expect(getFileTabButton('SKILL.md')).toBeInTheDocument()
  })

  it('pins a file tab on sidebar double click', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    await user.dblClick(getFileTreeButton('README.md'))
    expect(getFileTabButton('README.md').querySelector('.italic')).not.toBeInTheDocument()

    await user.click(getFileTreeButton('prompt.md'))
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.closeFileTab:{"name":"README.md"}',
      }),
    ).toBeInTheDocument()
    expect(getFileTabButton('prompt.md').querySelector('.italic')).toBeInTheDocument()
  })

  it('promotes a temporary tab to a pinned tab when its file is edited', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    await user.click(getFileTreeButton('notes.txt'))
    expect(getFileTabButton('notes.txt').querySelector('.italic')).toBeInTheDocument()

    const notesEditor = screen
      .getAllByRole('textbox')
      .find(
        (textbox): textbox is HTMLTextAreaElement =>
          textbox instanceof HTMLTextAreaElement && textbox.value === 'Notes',
      )
    expect(notesEditor).toBeDefined()
    await user.clear(notesEditor!)
    await user.type(notesEditor!, 'Updated notes')
    expect(getFileTabButton('notes.txt').querySelector('.italic')).not.toBeInTheDocument()
  })

  it('does not draw an accent focus ring around the plain text editor', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createFileTabSkillDetail()
    renderSkillDetailPage()

    await screen.findByRole('button', {
      name: 'skill.skillManagement.detail.markdownLiveMode',
    })
    await user.click(getFileTreeButton('notes.txt'))

    const notesEditor = screen
      .getAllByRole('textbox')
      .find(
        (textbox): textbox is HTMLTextAreaElement =>
          textbox instanceof HTMLTextAreaElement && textbox.value === 'Notes',
      )
    expect(notesEditor).toBeDefined()
    notesEditor!.focus()

    expect(notesEditor).not.toHaveClass('focus-visible:ring-2')
    expect(notesEditor).not.toHaveClass('focus-visible:ring-state-accent-solid')
  })

  it('sends suggestion chips as Builder messages and blocks concurrent sends', async () => {
    const user = userEvent.setup()
    mocks.sendSkillAssistMessage.mockImplementation(() => new Promise<void>(() => undefined))
    mocks.skillDetail = createDefaultSkillDraftDetail()

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'skill.skillManagement.detail.builder.exampleIssueTriage',
        }),
      )
    })
    expect(
      await screen.findByText('skill.skillManagement.detail.builder.thinking'),
    ).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(
      await screen.findByPlaceholderText('skill.skillManagement.detail.builder.modifyPlaceholder'),
    ).toBeDisabled()

    expect(mocks.sendSkillAssistMessage).toHaveBeenCalledTimes(1)
  })

  it('updates the selected editor from the Skill Builder detail event', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    const nextSkillMd =
      '---\nname: builder-updated-skill\ndescription: Updated by Skill Builder.\nmetadata:\n  display-name: Builder Updated Skill\n---\n# Builder Updated Skill\n'
    const nextDetail = createDefaultSkillDraftDetail({
      name: 'builder-updated-skill',
      display_name: 'Builder Updated Skill',
      description: 'Updated by Skill Builder.',
      updated_at: 1784638490,
      files: [
        {
          id: 'file-1',
          path: 'SKILL.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: nextSkillMd,
          tool_file_id: null,
          size: nextSkillMd.length,
          hash: 'updated-hash-1',
        },
      ],
    })
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onData?.('Updated SKILL.md.', true, {})
      onUnhandledEvent?.({
        event: 'skill_detail_updated',
        detail: nextDetail,
        operations: [{ operation: 'upsert_text', path: 'SKILL.md' }],
      })
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          targetPath: 'SKILL.md',
        }),
      )
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
    await waitFor(() => {
      const currentSourceEditor = screen
        .getAllByRole('textbox')
        .find(
          (editor): editor is HTMLTextAreaElement =>
            editor instanceof HTMLTextAreaElement && editor.value.includes('Builder Updated Skill'),
        )
      expect(currentSourceEditor?.value).toContain('# Builder Updated Skill')
    })
  })

  it('keeps assistant prose in the chat without using it as file content', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData }) => {
      onData?.('I can create that reference file.', true, {})
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.click(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    expect(await screen.findByText('I can create that reference file.')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: /skill\.skillManagement\.detail\.builder\.thinking/,
      }),
    )
    expect(
      screen.getByText('skill.skillManagement.detail.builder.thinkingUnavailable'),
    ).toBeInTheDocument()
    expect(screen.getByText('0s')).toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('sends Skill Builder follow-up suggestions after an assistant reply', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onUnhandledEvent?.({
        event: 'skill_assistant_progress',
        stage: 'reading_draft',
      })
      onUnhandledEvent?.({
        event: 'skill_assistant_reasoning_chunk',
        reasoning: 'Inspecting the current skill draft.',
      })
      onData?.('Drafted the skill.', true, {})
      onUnhandledEvent?.({
        event: 'skill_assistant_suggestions',
        suggestions: ['Ask me about required inputs first'],
      })
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )
    await screen.findByText('Drafted the skill.')
    expect(screen.queryByText('Inspecting the current skill draft.')).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', {
        name: /skill\.skillManagement\.detail\.builder\.thinking/,
      }),
    )
    expect(screen.getByText('Inspecting the current skill draft.')).toBeInTheDocument()
    expect(
      screen.queryByText('skill.skillManagement.detail.builder.progress.readingDraft'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'Ask me about required inputs first',
      }),
    )

    await waitFor(() => {
      expect(mocks.sendSkillAssistMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Ask me about required inputs first',
        }),
      )
    })
  })

  it('shows Skill Builder progress steps when thinking content is unavailable', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createDefaultSkillDraftDetail()
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onUnhandledEvent?.({
        event: 'skill_assistant_progress',
        stage: 'reading_draft',
      })
      onUnhandledEvent?.({
        event: 'skill_assistant_progress',
        stage: 'generating_plan',
      })
      onData?.('Drafted the skill.', true, {})
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )
    await screen.findByText('Drafted the skill.')
    await user.click(
      screen.getByRole('button', {
        name: /skill\.skillManagement\.detail\.builder\.thinking/,
      }),
    )

    expect(
      screen.getByText('skill.skillManagement.detail.builder.progress.readingDraft'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('skill.skillManagement.detail.builder.progress.generatingPlan'),
    ).toBeInTheDocument()
  })

  it('serializes editor autosave and file creation with the latest timestamp', async () => {
    const user = userEvent.setup()
    let resolveAutosave!: (detail: SkillDetailResponse) => void
    const autosavePromise = new Promise<SkillDetailResponse>((resolve) => {
      resolveAutosave = resolve
    })
    const autosavedDetail = createSkillDetail({
      updated_at: 1784638490,
    })
    const createdDetail = createSkillDetail({
      updated_at: 1784638491,
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'notes.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '',
          tool_file_id: null,
          size: 0,
          hash: 'hash-2',
        },
      ],
    })
    mocks.saveDraftFileMutationFn
      .mockImplementationOnce(() => autosavePromise)
      .mockResolvedValueOnce(createdDetail)
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    await user.type(getSourceEditor(), '\nAutosave in progress')
    await waitFor(
      () => {
        expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)
      },
      { timeout: 2500 },
    )

    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.type(await screen.findByPlaceholderText('File name'), 'notes.md{Enter}')

    expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAutosave(autosavedDetail)
      await autosavePromise
    })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2)
    })
    expect(mocks.saveDraftFileMutationFn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: 1784638490,
          operation: 'upsert_text',
          path: 'notes.md',
        }),
      }),
    )
  })

  it('updates non-SKILL files from the Skill Builder detail event', async () => {
    const user = userEvent.setup()
    const referenceFile = {
      id: 'file-2',
      path: 'references/refund-policy.md',
      kind: 'file' as const,
      storage: 'text' as const,
      mime_type: 'text/markdown',
      content: '# Refund Policy\n',
      tool_file_id: null,
      size: 16,
      hash: 'reference-hash-1',
    }
    mocks.skillDetail = createDefaultSkillDraftDetail()
    const nextDetail = createDefaultSkillDraftDetail({
      updated_at: 1784638490,
      files: [...createDefaultSkillDraftDetail().files!, referenceFile],
    })
    mocks.sendSkillAssistMessage.mockImplementation(({ onCompleted, onData, onUnhandledEvent }) => {
      onData?.('Created references/refund-policy.md.', true, {})
      onUnhandledEvent?.({
        event: 'skill_detail_updated',
        detail: nextDetail,
        operations: [{ operation: 'upsert_text', path: 'references/refund-policy.md' }],
      })
      onCompleted?.()
      return Promise.resolve()
    })

    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.builder.exampleIssueTriage',
      }),
    )

    expect(await screen.findByText('references')).toBeInTheDocument()
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('creates a folder from the root file menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFolderMenu'))
    const folderNameInput = await screen.findByPlaceholderText('Folder name')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(folderNameInput).toHaveFocus()
    expect(folderNameInput).toHaveValue('')
    await user.type(folderNameInput, 'references{Enter}')

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

  it('creates a file when a non-empty inline name loses focus', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText('File name')

    await user.type(fileNameInput, 'notes.md')
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'notes.md',
            mime_type: 'text/markdown',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('does not overwrite an existing file when creating a duplicate name', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...(createSkillDetail().files ?? []),
        {
          id: 'notes-file',
          path: 'notes.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# Existing notes',
          tool_file_id: null,
          size: 16,
          hash: 'notes-hash',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('notes.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText('File name')

    await user.type(fileNameInput, 'notes.md')
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('skill.skillManagement.detail.fileAlreadyExists')
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('creates a JSON file with a code-editor-compatible MIME type', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText('File name')

    await user.type(fileNameInput, 'tool.schema.json')
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            mime_type: 'application/json',
            operation: 'upsert_text',
            path: 'tool.schema.json',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('preserves the file list order returned by the service', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        createSkillDetail().files![0]!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
        {
          id: 'file-3',
          path: 'README.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# README\n',
          tool_file_id: null,
          size: 9,
          hash: 'hash-3',
        },
        {
          id: 'file-4',
          path: 'notes.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '',
          tool_file_id: null,
          size: 0,
          hash: 'hash-4',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('notes.md')).toBeInTheDocument()
    })

    const expectedOrder = ['SKILL.md', 'scripts', 'README.md', 'notes.md'].map(getFileTreeItem)
    for (const [index, item] of expectedOrder.entries()) {
      const nextItem = expectedOrder[index + 1]
      if (nextItem)
        expect(item.compareDocumentPosition(nextItem)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    }
  })

  it('removes an empty inline create input when it loses focus', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText('File name')

    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    await waitFor(() => {
      expect(fileNameInput).not.toBeInTheDocument()
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('creates a file inline inside a folder', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'scripts')
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    const fileNameInput = await screen.findByPlaceholderText('File name')

    expect(fileNameInput.closest('ul')).toContainElement(getFileTreeItem('scripts/example.ts'))
    await user.type(fileNameInput, 'helper.ts{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'scripts/helper.ts',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('creates a folder inline inside a folder', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'scripts')
    await user.click(await screen.findByText('skill.skillManagement.detail.createFolderMenu'))
    const folderNameInput = await screen.findByPlaceholderText('Folder name')

    expect(folderNameInput.closest('ul')).toContainElement(getFileTreeItem('scripts/example.ts'))
    await user.type(folderNameInput, 'helpers{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'mkdir',
            path: 'scripts/helpers',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('collapses and expands nested folders from the file tree', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('scripts'))
    expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument()

    await user.dblClick(folder)
    expect(document.querySelector('[title="scripts/example.ts"]')).not.toBeInTheDocument()

    await user.dblClick(folder)
    expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument()
  })

  it('uses only the native path tooltip for a file tree item', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts/example.ts')).toBeInTheDocument()
    })
    const fileButton = getFileTreeButton('scripts/example.ts')

    expect(fileButton).toHaveAttribute('title', 'scripts/example.ts')
    expect(screen.queryByText('scripts/example.ts')).not.toBeInTheDocument()
  })

  it('renames a file inline and selects its name without the extension', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.jsonl',
          kind: 'file',
          storage: 'text',
          mime_type: 'application/jsonl',
          content: '',
          tool_file_id: null,
          size: 0,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('scripts/example.jsonl')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'scripts/example.jsonl')
    await user.click(await screen.findByText('common.operation.rename...'))
    const renameInput = await screen.findByDisplayValue('example.jsonl')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveProperty('selectionStart', 0)
    expect(renameInput).toHaveProperty('selectionEnd', 7)

    await user.clear(renameInput)
    await user.type(renameInput, 'renamed.jsonl{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.jsonl',
            target_path: 'scripts/renamed.jsonl',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('cancels inline rename without saving when the name is unchanged', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openFileTreeActions(user, 'SKILL.md')
    await user.click(await screen.findByText('common.operation.rename...'))
    const renameInput = await screen.findByDisplayValue('SKILL.md')

    fireEvent.keyDown(renameInput, { key: 'Enter' })

    await waitFor(() => {
      expect(renameInput).not.toBeInTheDocument()
    })
    expect(mocks.saveDraftFileMutationFn).not.toHaveBeenCalled()
  })

  it('shows a toast when creating a file from the file tree fails', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockRejectedValueOnce(new Error('backend exploded'))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    await openRootCreateMenu(user)
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.type(await screen.findByPlaceholderText('File name'), 'broken.md{Enter}')

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('backend exploded')
    })
  })

  it('opens the file action menu by right-clicking a file row', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    fireEvent.contextMenu(getFileTreeItem('SKILL.md'), {
      button: 2,
      clientX: 120,
      clientY: 240,
    })

    expect(await screen.findByText('common.operation.rename...')).toBeInTheDocument()
    expect(screen.getByText('skill.skillManagement.detail.cutFile')).toBeInTheDocument()
    expect(screen.getAllByText('⌘')).toHaveLength(2)
    expect(screen.getByText('X')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('copies the context-menu file with the displayed keyboard shortcut', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    fireEvent.contextMenu(getFileTreeItem('SKILL.md'), {
      button: 2,
      clientX: 120,
      clientY: 240,
    })
    await screen.findByText('common.operation.rename...')

    const copyMenuItem = screen.getByRole('menuitem', {
      name: /skillManagement\.detail\.copyFile/,
    })
    copyMenuItem.addEventListener('keydown', (event) => event.stopPropagation())
    fireEvent.keyDown(copyMenuItem, {
      code: 'KeyC',
      key: 'c',
      ...primaryModifier,
    })

    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.detail.copyContentSuccess')
  })

  it('cuts the context-menu file with the displayed keyboard shortcut', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    fireEvent.contextMenu(getFileTreeItem('SKILL.md'), {
      button: 2,
      clientX: 120,
      clientY: 240,
    })
    await screen.findByText('common.operation.rename...')

    const cutMenuItem = screen.getByRole('menuitem', {
      name: /skill\.skillManagement\.detail\.cutFile/,
    })
    cutMenuItem.addEventListener('keydown', (event) => event.stopPropagation())
    fireEvent.keyDown(cutMenuItem, {
      code: 'KeyX',
      key: 'x',
      ...primaryModifier,
    })

    expect(toast.success).toHaveBeenCalledWith('skill.skillManagement.detail.cutFileSuccess')
  })

  it('copies a file with the keyboard shortcut and pastes it into the selected folder', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          kind: 'directory',
          path: 'scripts',
          size: 0,
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.copy(getFileTreeButton('SKILL.md'))
    await user.click(screen.getByRole('button', { name: 'scripts' }))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'scripts/SKILL.md',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('lets editable fields handle native copy even when page selection contains an empty draft marker', async () => {
    const user = userEvent.setup()
    const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => '<!-- dify-skill-empty-draft -->',
    } as Selection)
    try {
      renderSkillDetailPage()

      await waitFor(() => {
        expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
      })
      await user.click(getFileTreeButton('SKILL.md'))
      const builderInput = screen.getByPlaceholderText(
        'skill.skillManagement.detail.builder.modifyPlaceholder',
      )
      fireEvent.copy(builderInput)

      expect(copy).not.toHaveBeenCalledWith('<!-- dify-skill-empty-draft -->')
      expect(toast.success).not.toHaveBeenCalledWith(
        'skill.skillManagement.detail.copyContentSuccess',
      )
      expect(toast.success).not.toHaveBeenCalledWith('skill.skillManagement.detail.copyFileSuccess')
    } finally {
      getSelectionSpy.mockRestore()
    }
  })

  it('does not let file-tree copy hotkeys override copying from the builder panel', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))

    const builderControl = screen.getByRole('button', {
      name: 'skill.skillManagement.detail.builder.close',
    })
    fireEvent.keyDown(builderControl, {
      code: 'KeyC',
      key: 'c',
      ...primaryModifier,
    })

    expect(copy).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalledWith(
      'skill.skillManagement.detail.copyContentSuccess',
    )
    expect(toast.success).not.toHaveBeenCalledWith('skill.skillManagement.detail.copyFileSuccess')
  })

  it('opens only the copied file after pasting it beside the source file', async () => {
    const user = userEvent.setup()
    const sourceFile = createSkillDetail().files![0]!
    const copiedFile = {
      ...sourceFile,
      id: 'file-2',
      path: 'SKILL copy.md',
      hash: 'hash-2',
    }
    mocks.saveDraftFileMutationFn.mockImplementationOnce(async () => {
      mocks.skillDetail = createSkillDetail({
        updated_at: 1784638490,
        files: [sourceFile, copiedFile],
      })
      return mocks.skillDetail
    })
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.copy(getFileTreeButton('SKILL.md'))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'SKILL copy.md',
          }),
        }),
        expect.anything(),
      )
    })
    await waitFor(() => {
      const editorMain = screen.getAllByRole('main').at(-1)
      if (!editorMain) throw new Error('file editor not found')
      expect(
        within(editorMain).getByRole('button', {
          name: 'SKILL copy.md',
        }),
      ).toBeInTheDocument()
    })
  })

  it('refreshes and retries a paste once when its skill timestamp is stale', async () => {
    const user = userEvent.setup()
    const sourceFile = createSkillDetail().files![0]!
    const latestDetail = createSkillDetail({
      updated_at: 1784638490,
      files: [sourceFile],
    })
    const copiedDetail = createSkillDetail({
      updated_at: 1784638491,
      files: [
        sourceFile,
        {
          ...sourceFile,
          id: 'file-2',
          path: 'SKILL copy.md',
          hash: 'hash-2',
        },
      ],
    })
    const conflict = new Error('skill has been modified by another user') as Error & {
      code: string
      details: {
        current_updated_at: number
        expected_updated_at: number
      }
    }
    conflict.code = 'skill_conflict'
    conflict.details = {
      current_updated_at: latestDetail.updated_at,
      expected_updated_at: 1784638487,
    }
    mocks.saveDraftFileMutationFn
      .mockRejectedValueOnce(conflict)
      .mockImplementationOnce(async () => {
        mocks.skillDetail = copiedDetail
        return copiedDetail
      })
    mocks.skillDetailGetFn.mockResolvedValueOnce(latestDetail)
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('SKILL.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.copy(getFileTreeButton('SKILL.md'))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2)
    })
    expect(mocks.saveDraftFileMutationFn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: latestDetail.updated_at,
          operation: 'upsert_text',
          path: 'SKILL copy.md',
        }),
      }),
    )
    expect(toast.error).not.toHaveBeenCalledWith('skill has been modified by another user')
  })

  it('retries only the current file when a multi-file paste becomes stale', async () => {
    const user = userEvent.setup()
    const sourceFiles = [
      {
        ...createSkillDetail().files![0]!,
        id: 'file-1',
        path: 'alpha.md',
      },
      {
        ...createSkillDetail().files![0]!,
        id: 'file-2',
        path: 'beta.md',
        hash: 'hash-2',
      },
    ]
    const copiedAlpha = {
      ...sourceFiles[0]!,
      id: 'file-3',
      path: 'alpha copy.md',
      hash: 'hash-3',
    }
    const afterAlphaCopy = createSkillDetail({
      updated_at: 1784638488,
      files: [...sourceFiles, copiedAlpha],
    })
    const refreshedDetail = createSkillDetail({
      updated_at: 1784638490,
      files: [...sourceFiles, copiedAlpha],
    })
    const copiedBeta = {
      ...sourceFiles[1]!,
      id: 'file-4',
      path: 'beta copy.md',
      hash: 'hash-4',
    }
    const afterBetaCopy = createSkillDetail({
      updated_at: 1784638491,
      files: [...sourceFiles, copiedAlpha, copiedBeta],
    })
    const conflict = new Error('skill has been modified by another user') as Error & {
      code: string
    }
    conflict.code = 'skill_conflict'

    mocks.skillDetail = createSkillDetail({ files: sourceFiles })
    mocks.saveDraftFileMutationFn
      .mockResolvedValueOnce(afterAlphaCopy)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(afterBetaCopy)
    mocks.skillDetailGetFn.mockResolvedValueOnce(refreshedDetail)
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('alpha.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('alpha.md'))
    fireEvent.click(getFileTreeButton('beta.md'), primaryModifier)
    fireEvent.copy(getFileTreeButton('beta.md'))
    fireEvent.paste(screen.getByTestId('skill-detail-sidebar'))

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(3)
    })
    expect(mocks.saveDraftFileMutationFn.mock.calls.map(([request]) => request.body.path)).toEqual([
      'alpha copy.md',
      'beta copy.md',
      'beta copy.md',
    ])
    expect(mocks.saveDraftFileMutationFn.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: refreshedDetail.updated_at,
        }),
      }),
    )
  })

  it('cuts a nested file and pastes it into the root after selecting the blank area', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    await user.click(await screen.findByRole('button', { name: 'example.ts' }))
    fireEvent.cut(getFileTreeButton('scripts/example.ts'))
    const contextRegion = document.querySelector('[data-skill-file-tree-context-region]')
    if (!(contextRegion instanceof HTMLElement))
      throw new Error('file tree context region not found')
    fireEvent.contextMenu(contextRegion, {
      button: 2,
      clientX: 160,
      clientY: 520,
    })
    const rootMenuItem = (
      await screen.findByText('skill.skillManagement.detail.createFileMenu')
    ).closest('[role="menuitem"]')
    if (!(rootMenuItem instanceof HTMLElement)) throw new Error('root menu item not found')
    fireEvent.keyDown(rootMenuItem, {
      code: 'KeyV',
      key: 'v',
      ...primaryModifier,
    })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.ts',
            target_path: 'example.ts',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('opens the create menu by right-clicking the file-list blank area', async () => {
    renderSkillDetailPage()

    const contextRegion = await waitFor(() => {
      const region = document.querySelector('[data-skill-file-tree-context-region]')
      if (!(region instanceof HTMLElement)) throw new Error('file tree context region not found')
      return region
    })
    fireEvent.contextMenu(contextRegion, {
      button: 2,
      clientX: 160,
      clientY: 520,
    })

    expect(
      await screen.findByText('skill.skillManagement.detail.createFileMenu'),
    ).toBeInTheDocument()
    expect(screen.getByText('skill.skillManagement.detail.createFolderMenu')).toBeInTheDocument()
    expect(screen.getByText('skill.skillManagement.detail.uploadFilesMenu')).toBeInTheDocument()
  })

  it('creates a file from the file-list blank-area context menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const contextRegion = await waitFor(() => getFileTreeContextRegion())
    fireEvent.contextMenu(contextRegion, {
      button: 2,
      clientX: 160,
      clientY: 520,
    })
    await user.click(await screen.findByText('skill.skillManagement.detail.createFileMenu'))
    await user.type(await screen.findByPlaceholderText('File name'), 'from-context.md{Enter}')

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_text',
            path: 'from-context.md',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('clears file tree multi-selection when clicking the blank area', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
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
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('README.md')).toBeInTheDocument()
    })
    await user.click(getFileTreeButton('SKILL.md'))
    fireEvent.click(getFileTreeButton('README.md'), primaryModifier)

    expect(getFileTreeItem('SKILL.md')).toHaveClass('bg-state-accent-hover')
    expect(getFileTreeItem('README.md')).toHaveClass('bg-state-accent-hover')

    fireEvent.click(getFileTreeContextRegion())

    await waitFor(() => {
      expect(getFileTreeItem('README.md')).not.toHaveClass('bg-state-accent-hover')
    })
  })

  it('selects a file tree range with Shift-click', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'README.md',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/markdown',
          content: '# Readme',
          tool_file_id: null,
          size: 8,
          hash: 'hash-2',
        },
        {
          id: 'file-3',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-3',
        },
      ],
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeButton('scripts/example.ts')).toBeInTheDocument()
    })
    fireEvent.click(getFileTreeButton('SKILL.md'))
    fireEvent.click(getFileTreeButton('scripts/example.ts'), { shiftKey: true })

    expect(getFileTreeItem('SKILL.md')).toHaveClass('bg-state-accent-hover')
    expect(getFileTreeItem('README.md')).toHaveClass('bg-state-accent-hover')
    expect(getFileTreeItem('scripts')).toHaveClass('bg-state-accent-hover')
    expect(getFileTreeItem('scripts/example.ts')).toHaveClass('bg-state-accent-hover')
  })

  it('uploads externally dragged files to the root file list', async () => {
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })
    const upload = new File(['root'], 'root-guide.md', { type: 'text/markdown' })
    const { dataTransfer } = createDataTransfer([upload])
    const contextRegion = getFileTreeContextRegion()

    fireEvent.dragOver(contextRegion, { dataTransfer })

    expect(screen.getByLabelText('Upload to root folder')).toBeInTheDocument()

    fireEvent.drop(contextRegion, { dataTransfer })
    await confirmUploadReview()

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledWith(
        upload,
        expect.objectContaining({
          onProgress: expect.any(Function),
          xhr: expect.any(XMLHttpRequest),
        }),
      )
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_tool_file',
            path: 'root-guide.md',
            tool_file_id: 'tool-file-1',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('reviews backend file checks and applies keep-both, suggestion, and skip decisions', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          content: null,
          hash: 'report-hash',
          id: 'report-file',
          kind: 'file',
          mime_type: 'application/pdf',
          path: 'report.pdf',
          size: 3,
          storage: 'tool_file',
          tool_file_id: 'existing-report',
        },
      ],
    })
    mocks.checkDraftFilesMutationFn.mockResolvedValueOnce({
      data: {
        'my notes!.md': {
          errors: [{ code: 'invalid_filename', message: 'filename is invalid' }],
          extension: '.md',
          filename: 'my notes!.md',
          mime_type: 'text/markdown',
          path: 'my notes!.md',
          size: 5,
        },
        'report.abcd': {
          errors: [{ code: 'invalid_file_extension', message: 'extension is invalid' }],
          extension: '.abcd',
          filename: 'report.abcd',
          mime_type: 'application/octet-stream',
          path: 'report.abcd',
          size: 4,
        },
        'report.pdf': {
          errors: [{ code: 'file_already_exists', message: 'file already exists' }],
          extension: '.pdf',
          filename: 'report.pdf',
          mime_type: 'application/pdf',
          path: 'report.pdf',
          size: 3,
        },
      },
    })
    renderSkillDetailPage()

    await waitFor(() => {
      expect(getFileTreeItem('SKILL.md')).toBeInTheDocument()
    })

    const uploads = [
      new File(['pdf'], 'report.pdf', { type: 'application/pdf' }),
      new File(['notes'], 'my notes!.md', { type: 'text/markdown' }),
      new File(['bad'], 'report.abcd'),
    ]
    fireEvent.drop(getFileTreeContextRegion(), {
      dataTransfer: createDataTransfer(uploads).dataTransfer,
    })

    const initialUploadButton = await screen.findByRole('button', { name: /uploadFilesButton/ })
    expect(initialUploadButton).toBeDisabled()
    expect(screen.getByText(/uploadSkippedGroup/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /uploadKeepBoth/ }))
    await user.click(screen.getByRole('button', { name: /uploadSuggestion/ }))
    const resolvedUploadButton = screen.getByRole('button', { name: /uploadFilesButton/ })
    expect(resolvedUploadButton).toBeEnabled()
    await user.click(resolvedUploadButton)

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledTimes(2)
      expect(
        mocks.saveDraftFileMutationFn.mock.calls.map(([request]) => request.body.path),
      ).toEqual(expect.arrayContaining(['report-2.pdf', 'my-notes.md']))
    })
  })

  it('uploads externally dragged files to the highlighted folder', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    const { dataTransfer } = createDataTransfer([upload])
    fireEvent.dragOver(folder.closest('li')!, { dataTransfer })

    expect(folder).toHaveClass('ring-state-accent-solid')
    expect(screen.getByLabelText('Upload to references')).toBeInTheDocument()

    fireEvent.drop(folder.closest('li')!, { dataTransfer })
    await confirmUploadReview()

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledWith(
        upload,
        expect.objectContaining({
          onProgress: expect.any(Function),
          xhr: expect.any(XMLHttpRequest),
        }),
      )
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_tool_file',
            path: 'references/guide.md',
            tool_file_id: 'tool-file-1',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('cancels an active file upload from the upload status panel', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    mocks.uploadSkillFile.mockImplementation(() => new Promise(() => undefined))
    const abortSpy = vi.spyOn(XMLHttpRequest.prototype, 'abort').mockImplementation(() => undefined)
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    fireEvent.drop(folder.closest('li')!, {
      dataTransfer: createDataTransfer([upload]).dataTransfer,
    })
    await confirmUploadReview()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(abortSpy).toHaveBeenCalledOnce()
  })

  it('retries failed file uploads from the upload status panel', async () => {
    const user = userEvent.setup()
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    mocks.uploadSkillFile
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce({
        id: 'tool-file-retry',
        name: 'guide.md',
        mime_type: 'text/markdown',
        size: 5,
      })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    fireEvent.drop(folder.closest('li')!, {
      dataTransfer: createDataTransfer([upload]).dataTransfer,
    })
    await confirmUploadReview()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'skill.skillManagement.detail.uploadFilesFailedStatus:{"count":1}',
      )
    })

    await user.click(screen.getByRole('button', { name: /viewUploadErrors/ }))
    await user.click(screen.getAllByRole('button', { name: 'common.operation.retry' })[0]!)

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledTimes(2)
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'upsert_tool_file',
            path: 'references/guide.md',
            tool_file_id: 'tool-file-retry',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('offers replace, keep-both, and skip when a file appears during upload', async () => {
    const user = userEvent.setup()
    const initialDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          content: null,
          hash: 'directory-hash',
          id: 'directory-1',
          kind: 'directory',
          mime_type: null,
          path: 'references',
          size: 0,
          storage: 'text',
          tool_file_id: null,
        },
      ],
    })
    mocks.skillDetail = initialDetail
    mocks.saveDraftFileMutationFn
      .mockImplementationOnce(async () => {
        mocks.skillDetail = createSkillDetail({
          updated_at: initialDetail.updated_at + 1,
          files: [
            ...initialDetail.files!,
            {
              content: null,
              hash: 'late-guide-hash',
              id: 'late-guide',
              kind: 'file',
              mime_type: 'text/markdown',
              path: 'references/guide.md',
              size: 5,
              storage: 'tool_file',
              tool_file_id: 'late-guide-tool-file',
            },
          ],
        })
        throw new Response(
          JSON.stringify({
            code: 'skill_conflict',
            message: 'skill has been modified by another user',
          }),
          { status: 409 },
        )
      })
      .mockImplementationOnce(async () => {
        mocks.skillDetail = createSkillDetail({ updated_at: initialDetail.updated_at + 2 })
        return mocks.skillDetail
      })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('references'))
    const upload = new File(['guide'], 'guide.md', { type: 'text/markdown' })
    fireEvent.drop(folder.closest('li')!, {
      dataTransfer: createDataTransfer([upload]).dataTransfer,
    })
    await confirmUploadReview()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /viewUploadErrors/ })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /viewUploadErrors/ }))
    expect(screen.getByText(/uploadLateConflict/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /uploadReplace/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /uploadSkip/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /uploadKeepBoth/ }))

    await waitFor(() => {
      expect(mocks.uploadSkillFile).toHaveBeenCalledTimes(2)
      expect(mocks.saveDraftFileMutationFn).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ path: 'references/guide-2.md' }),
        }),
        expect.anything(),
      )
    })
  })

  it('moves the complete multi-selection and uses the designed drag preview', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
        {
          id: 'directory-1',
          path: 'references',
          kind: 'directory',
          storage: 'text',
          mime_type: null,
          content: null,
          tool_file_id: null,
          size: 0,
          hash: 'directory-hash',
        },
      ],
    })
    renderSkillDetailPage()

    const skillFile = await waitFor(() => getFileTreeItem('SKILL.md'))
    const exampleFile = getFileTreeItem('scripts/example.ts')
    const targetFolder = getFileTreeItem('references')
    fireEvent.click(getFileTreeButton('SKILL.md'))
    fireEvent.click(getFileTreeButton('scripts/example.ts'), { metaKey: true })

    const { dataTransfer, setDragImage } = createDataTransfer()
    fireEvent.dragStart(exampleFile, { dataTransfer })
    expect(setDragImage).toHaveBeenCalledOnce()
    expect(setDragImage.mock.calls[0]?.[0]).toHaveTextContent('2 items')
    expect(skillFile).toHaveClass('opacity-30')
    expect(exampleFile).toHaveClass('opacity-30')

    fireEvent.dragOver(targetFolder.closest('li')!, { dataTransfer })
    expect(screen.getByLabelText('Move to references')).toBeInTheDocument()
    fireEvent.drop(targetFolder.closest('li')!, { dataTransfer })

    await waitFor(() => {
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'SKILL.md',
            target_path: 'references/SKILL.md',
          }),
        }),
        expect.anything(),
      )
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            operation: 'rename',
            path: 'scripts/example.ts',
            target_path: 'references/example.ts',
          }),
        }),
        expect.anything(),
      )
    })
  })

  it('expands a collapsed folder after a two-second drag hover', async () => {
    mocks.skillDetail = createSkillDetail({
      files: [
        ...createSkillDetail().files!,
        {
          id: 'file-2',
          path: 'scripts/example.ts',
          kind: 'file',
          storage: 'text',
          mime_type: 'text/typescript',
          content: 'export {}\n',
          tool_file_id: null,
          size: 10,
          hash: 'hash-2',
        },
      ],
    })
    renderSkillDetailPage()

    const folder = await waitFor(() => getFileTreeItem('scripts'))
    fireEvent.doubleClick(folder)
    expect(document.querySelector('[title="scripts/example.ts"]')).not.toBeInTheDocument()

    vi.useFakeTimers()
    try {
      const { dataTransfer } = createDataTransfer([new File(['x'], 'x.txt')])
      fireEvent.dragOver(folder.closest('li')!, { dataTransfer })
      act(() => vi.advanceTimersByTime(1999))
      expect(document.querySelector('[title="scripts/example.ts"]')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(1))
      expect(getFileTreeItem('scripts/example.ts')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
    )
    await openVersionRowActions(user, 'Initial version')
    await user.click(await screen.findByText('skill.skillManagement.detail.nameThisVersion'))
    const dialog = await screen.findByRole('dialog')
    const [titleInput, noteInput] = within(dialog).getAllByRole('textbox')
    if (!titleInput || !noteInput) throw new Error('version info inputs not found')

    await user.clear(titleInput)
    await user.type(titleInput, 'Named version')
    await user.clear(noteInput)
    await user.type(noteInput, 'Release note')
    await user.click(
      within(dialog).getByRole('button', { name: 'skill.skillManagement.detail.publish' }),
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
      await screen.findByRole('button', { name: 'skill.skillManagement.detail.versionHistory' }),
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
