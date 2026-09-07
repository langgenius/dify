import type { SkillReferenceResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createAgentReference,
  createSkillDetail,
  createSkillVersion,
  getMocks,
  openVersionRowActions,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage publishing', () => {
  beforeEach(resetDetailPageFixture)

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
      expect(mocks.toastError).toHaveBeenCalledWith('SKILL.md frontmatter name is required')
    })
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
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
    await user.click(
      within(publishDialog).getByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })
  })

  it('refreshes a fresh empty references cache before publishing', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    const referencesQueryKey = [
      'skill-references',
      {
        params: {
          skill_id: 'skill-1',
        },
      },
    ]
    let remoteReferences: SkillReferenceResponse[] = []
    const referencesQueryFn = vi.fn(async () => ({ data: remoteReferences }))
    mocks.skillDetail = createSkillDetail({ reference_count: 0 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', (options as { input: unknown }).input],
      queryFn: referencesQueryFn,
    }))
    queryClient.setQueryData(referencesQueryKey, { data: [] })

    renderSkillDetailPage({ queryClient })

    await waitFor(() => {
      expect(referencesQueryFn).toHaveBeenCalled()
      expect(queryClient.getQueryState(referencesQueryKey)?.fetchStatus).toBe('idle')
    })
    remoteReferences = [
      createAgentReference({
        display_name: 'Fresh Cache Agent',
        name: 'fresh-cache-agent',
      }),
    ]
    referencesQueryFn.mockClear()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    expect(referencesQueryFn).toHaveBeenCalled()
    expect(
      await screen.findByRole('dialog', {
        name: 'skill.skillManagement.detail.publishReferencesTitle',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('skill.skillManagement.detail.publishReferencesDescription_one:{"count":1}'),
    ).toBeInTheDocument()
    expect(await screen.findByText('Fresh Cache Agent')).toBeInTheDocument()
    expect(mocks.publishSkillMutationFn).not.toHaveBeenCalled()
  })

  it('does not publish when refreshing references fails', async () => {
    const user = userEvent.setup()
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    let refreshShouldFail = false
    const referencesQueryFn = vi.fn(async () => {
      if (refreshShouldFail) throw new Error('references unavailable')
      return { data: [] }
    })
    mocks.skillDetail = createSkillDetail({ reference_count: 0 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', (options as { input: unknown }).input],
      queryFn: referencesQueryFn,
    }))

    renderSkillDetailPage({ queryClient })

    await waitFor(() => {
      expect(referencesQueryFn).toHaveBeenCalled()
      expect(queryClient.isFetching()).toBe(0)
    })
    refreshShouldFail = true
    referencesQueryFn.mockClear()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )

    await waitFor(() => expect(referencesQueryFn).toHaveBeenCalledOnce())
    expect(mocks.publishSkillMutationFn).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('dialog', {
        name: 'skill.skillManagement.detail.publishReferencesTitle',
      }),
    ).not.toBeInTheDocument()
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
        name: 'skill.skillManagement.detail.referencedBy_one:{"count":1}',
      }),
    )

    const referencesPopover = await screen.findByRole('dialog', {
      name: 'skill.skillManagement.detail.referencedBy_one:{"count":1}',
    })
    const sidebarReferenceLink = within(referencesPopover).getByRole('link', {
      name: /Sidebar Agent/,
    })
    expect(sidebarReferenceLink).toBeInTheDocument()
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

  it('renders a non-interactive reference count when no agent uses the skill', async () => {
    mocks.skillDetail = createSkillDetail({ reference_count: 0 })
    mocks.skillReferencesQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-references', options],
      queryFn: async () => ({ data: [] }),
    }))

    renderSkillDetailPage()

    const referenceCount = await screen.findByText(
      'skill.skillManagement.detail.referencedBy_other:{"count":0}',
    )
    expect(referenceCount).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'skill.skillManagement.detail.referencedBy_other:{"count":0}',
      }),
    ).not.toBeInTheDocument()
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
      await screen.findByRole(
        'button',
        { name: 'skill.skillManagement.detail.referencedBy_one:{"count":1}' },
        { timeout: 5000 },
      ),
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
        name: 'skill.skillManagement.detail.referencedBy_one:{"count":1}',
      }),
    )
    expect(await screen.findByText('Sidebar Agent')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'app.gotoAnything.searchTitle',
      }),
    )

    await waitFor(() => {
      expect(screen.queryByText('Sidebar Agent')).not.toBeInTheDocument()
    })
  })

  it('reveals the remaining publish references on request', async () => {
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
    expect(within(referenceList).getAllByRole('link')).toHaveLength(5)
    expect(within(referenceList).queryByText('Reference 6')).not.toBeInTheDocument()

    await user.click(
      within(referenceList).getByRole('button', {
        name: 'skill.skillManagement.detail.showMoreReferences:{"count":6}',
      }),
    )

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

  it('filters version history and returns to the current draft', async () => {
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

    await screen.findByText('skill.skillManagement.detail.versions')
    expect(screen.getAllByRole('button', { current: true })).toHaveLength(1)

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
