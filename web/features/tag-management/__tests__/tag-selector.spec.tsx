import type { TagResponse as Tag } from '@dify/contracts/api/console/tags/types.gen'
import type { TagSelectorProps } from '../components/tag-selector'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatasetCardTags } from '../components/dataset-card-tags'
import { TagSelector } from '../components/tag-selector'
import { renderWithTags } from './render'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

vi.mock('@/app/notifications', () => ({ toast: mockToast }))

const { mockUseQueryData, createTag, bindTag, unBindTag } = vi.hoisted(() => {
  const mockUseQueryData: { current: Tag[] } = { current: [] }
  return {
    mockUseQueryData,
    createTag: vi.fn(),
    bindTag: vi.fn(),
    unBindTag: vi.fn(),
  }
})

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['app.tag.manage', 'dataset.tag.manage', 'snippets.create_and_modify'] as string[],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return {
    ...actual,
    consoleClient: {
      ...actual.consoleClient,
      tagBindings: {
        post: ({ body }: Parameters<typeof actual.consoleClient.tagBindings.post>[0]) =>
          bindTag(body.tag_ids, body.target_id, body.type),
        remove: {
          post: ({ body }: Parameters<typeof actual.consoleClient.tagBindings.remove.post>[0]) =>
            unBindTag(body.tag_ids, body.target_id, body.type),
        },
      },
    },
    consoleQuery: {
      ...actual.consoleQuery,
      apps: actual.consoleQuery.apps,
      tags: {
        ...actual.consoleQuery.tags,
        get: {
          queryKey: actual.consoleQuery.tags.get.queryKey,
          key: actual.consoleQuery.tags.get.key,
          queryOptions: (
            ...args: Parameters<typeof actual.consoleQuery.tags.get.queryOptions>
          ) => ({
            ...actual.consoleQuery.tags.get.queryOptions(...args),
            queryFn: async () => mockUseQueryData.current,
          }),
        },
        post: {
          mutationOptions: () => ({
            mutationFn: ({
              body,
            }: {
              body: { name: string; type: 'app' | 'knowledge' | 'snippet' }
            }) => createTag(body.name, body.type),
          }),
        },
      },
    },
  }
})

const i18n = {
  addTag: 'common.tag.addTag',
  noTag: 'common.tag.noTag',
  selectorPlaceholder: 'common.tag.selectorPlaceholder',
  manageTags: 'common.tag.manageTags',
  modifiedSuccessfully: 'common.actionMsg.modifiedSuccessfully',
  modifiedUnsuccessfully: 'common.actionMsg.modifiedUnsuccessfully',
}

const appTags: Tag[] = [
  { id: 'tag-1', name: 'Frontend', type: 'app', binding_count: '' },
  { id: 'tag-2', name: 'Backend', type: 'app', binding_count: '' },
]

const defaultProps = {
  targetId: 'target-1',
  type: 'app',
  value: [appTags[0]!],
} satisfies TagSelectorProps

const render = (ui: Parameters<typeof renderWithTags>[0]) =>
  renderWithTags(ui, mockUseQueryData.current)

describe('TagSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = [
      'app.tag.manage',
      'dataset.tag.manage',
      'snippets.create_and_modify',
    ]
    mockUseQueryData.current = appTags
    vi.mocked(createTag).mockResolvedValue({
      id: 'new-tag',
      name: 'NewTag',
      type: 'app',
      binding_count: '',
    })
    vi.mocked(bindTag).mockResolvedValue(undefined)
    vi.mocked(unBindTag).mockResolvedValue(undefined)
  })

  it('renders selected tag names in the combobox trigger', () => {
    render(<TagSelector {...defaultProps} />)
    expect(screen.getByText('Frontend')).toBeInTheDocument()
  })

  it('adds the owning app name to the combobox accessible name', () => {
    render(<TagSelector {...defaultProps} contextLabel="Test App" />)

    expect(screen.getByRole('combobox', { name: 'Frontend: Test App' })).toBeInTheDocument()
  })

  it('keeps dataset tag interactions inside the tag trigger', async () => {
    const user = userEvent.setup()
    const onOuterClick = vi.fn()
    mockUseQueryData.current = []

    document.addEventListener('click', onOuterClick)
    try {
      render(<DatasetCardTags datasetId="dataset-1" embeddingAvailable tags={[]} />)

      await user.click(screen.getByRole('combobox', { name: i18n.noTag }))

      expect(onOuterClick).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', onOuterClick)
    }
  })

  it('keeps dataset tag popup option interactions inside the tag trigger', async () => {
    const user = userEvent.setup()
    const onOuterClick = vi.fn()
    const onTagsChange = vi.fn()
    mockUseQueryData.current = [
      { id: 'knowledge-tag-1', name: 'Knowledge', type: 'knowledge', binding_count: '' },
    ]

    document.addEventListener('click', onOuterClick)
    try {
      render(
        <DatasetCardTags
          datasetId="dataset-1"
          embeddingAvailable
          tags={[]}
          canBindOrUnbindTags
          onTagsChange={onTagsChange}
        />,
      )

      await user.click(screen.getByRole('combobox', { name: i18n.addTag }))
      await user.click(await screen.findByRole('option', { name: 'Knowledge' }))
      await user.type(screen.getByRole('combobox', { name: i18n.selectorPlaceholder }), 'NewTag')
      await user.click(await screen.findByRole('option', { name: /NewTag/ }))
      await user.click(screen.getByRole('button', { name: i18n.manageTags }))

      await waitFor(() => expect(onTagsChange).toHaveBeenCalled())
      expect(onOuterClick).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('click', onOuterClick)
    }
  })

  it('renders the no tag trigger when no current tag is visible and binding is unavailable', () => {
    render(
      <TagSelector
        {...defaultProps}
        value={[{ id: 'orphan', name: 'Orphan', type: 'app', binding_count: '' }]}
      />,
    )
    expect(screen.queryByText('Orphan')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.noTag)).toBeInTheDocument()
    expect(screen.queryByText(i18n.addTag)).not.toBeInTheDocument()
  })

  it('renders the add tag trigger when no current tag is visible and binding is available', () => {
    render(
      <TagSelector
        {...defaultProps}
        value={[{ id: 'orphan', name: 'Orphan', type: 'app', binding_count: '' }]}
        canBindOrUnbindTags
      />,
    )
    expect(screen.queryByText('Orphan')).not.toBeInTheDocument()
    expect(screen.getByText(i18n.addTag)).toBeInTheDocument()
  })

  it('opens a searchable combobox popup', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    await user.click(screen.getByRole('combobox', { name: /Frontend/i }))

    expect(
      await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }),
    ).toBeInTheDocument()
    expect(screen.getByText(i18n.manageTags)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Backend/i })).toBeInTheDocument()
  })

  it('matches existing tags without offering a case-only duplicate', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    await user.click(screen.getByRole('combobox', { name: /Frontend/i }))
    await user.type(
      await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }),
      'frontend',
    )

    expect(screen.getByRole('option', { name: 'Frontend' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /common\.tag\.create/i })).not.toBeInTheDocument()
  })

  it('applies added tags on close and refreshes their names from the query', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Backend/i }))

    expect(bindTag).not.toHaveBeenCalled()

    mockUseQueryData.current = [{ ...appTags[0]!, name: 'Frontend refreshed' }, appTags[1]!]
    await user.click(trigger)

    await waitFor(() => {
      expect(bindTag).toHaveBeenCalledWith(['tag-2'], 'target-1', 'app')
    })
    expect(await screen.findByRole('combobox', { name: 'Frontend refreshed' })).toBeInTheDocument()
    expect(mockToast.success).toHaveBeenCalledWith(i18n.modifiedSuccessfully, {
      id: 'tag-bindings-app-target-1',
    })
  })

  it('selects the highlighted tag with keyboard navigation and applies it on close', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.type(await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }), 'Back')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    await user.click(trigger)

    await waitFor(() => {
      expect(bindTag).toHaveBeenCalledWith(['tag-2'], 'target-1', 'app')
    })
  })

  it('applies removed tags only when the popup closes', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Frontend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(unBindTag).toHaveBeenCalledWith(['tag-1'], 'target-1', 'app')
    })
  })

  it('does not submit unchanged draft selections on close', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await screen.findByRole('combobox', { name: i18n.selectorPlaceholder })
    await user.click(trigger)

    expect(bindTag).not.toHaveBeenCalled()
    expect(unBindTag).not.toHaveBeenCalled()
    expect(mockToast.success).not.toHaveBeenCalled()
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(onTagsChange).not.toHaveBeenCalled()
  })

  it('notifies after apply settles with success or error', async () => {
    const user = userEvent.setup()
    const onTagsChange = vi.fn()
    render(<TagSelector {...defaultProps} onTagsChange={onTagsChange} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Backend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(onTagsChange).toHaveBeenCalledTimes(1)
    })
  })

  it('shows an error toast when applying bindings fails', async () => {
    const user = userEvent.setup()
    vi.mocked(unBindTag).mockRejectedValueOnce(new Error('Unbind failed'))
    render(<TagSelector {...defaultProps} />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Frontend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(i18n.modifiedUnsuccessfully, {
        id: 'tag-bindings-app-target-1',
      })
    })
  })

  it('creates a tag with the current tag type without binding it implicitly', async () => {
    const user = userEvent.setup()
    render(<TagSelector {...defaultProps} type="knowledge" value={[]} />)

    await user.click(screen.getByRole('combobox', { name: i18n.noTag }))
    await user.type(
      await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }),
      'NewKnowledgeTag',
    )
    await user.click(await screen.findByRole('option', { name: /NewKnowledgeTag/i }))

    await waitFor(() => {
      expect(createTag).toHaveBeenCalledWith('NewKnowledgeTag', 'knowledge')
    })
    expect(bindTag).not.toHaveBeenCalled()
  })

  it('does not open the tag selector when neither tag management nor binding capability is available', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = []

    render(<TagSelector {...defaultProps} />)

    await user.click(screen.getByRole('combobox', { name: /Frontend/i }))

    expect(
      screen.queryByRole('combobox', { name: i18n.selectorPlaceholder }),
    ).not.toBeInTheDocument()
  })

  it('opens the tag selector with binding capability even without workspace tag management permission', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = []

    render(<TagSelector {...defaultProps} canBindOrUnbindTags />)

    await user.click(screen.getByRole('combobox', { name: /Frontend/i }))

    expect(
      await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.manageTags })).not.toBeInTheDocument()
  })

  it('applies added tags with binding capability even without workspace tag management permission', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = []

    render(<TagSelector {...defaultProps} canBindOrUnbindTags />)

    const trigger = screen.getByRole('combobox', { name: /Frontend/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: /Backend/i }))
    await user.click(trigger)

    await waitFor(() => {
      expect(bindTag).toHaveBeenCalledWith(['tag-2'], 'target-1', 'app')
    })
  })

  it('does not create new tags when only binding capability is available', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = []

    render(<TagSelector {...defaultProps} canBindOrUnbindTags />)

    await user.click(screen.getByRole('combobox', { name: /Frontend/i }))
    await user.type(
      await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }),
      'BrandNewTag',
    )

    expect(screen.queryByRole('option', { name: /BrandNewTag/i })).not.toBeInTheDocument()
    expect(createTag).not.toHaveBeenCalled()
  })

  it('opens snippet tag selector with snippets create-and-modify permission', async () => {
    const user = userEvent.setup()
    mockWorkspacePermissionKeys.value = ['snippets.create_and_modify']
    mockUseQueryData.current = [
      { id: 'snippet-tag-1', name: 'Reusable', type: 'snippet', binding_count: '' },
    ]

    render(
      <TagSelector
        targetId="snippet-1"
        type="snippet"
        value={[{ id: 'snippet-tag-1', name: 'Reusable', type: 'snippet', binding_count: '' }]}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /Reusable/i }))

    expect(
      await screen.findByRole('combobox', { name: i18n.selectorPlaceholder }),
    ).toBeInTheDocument()
  })
})
