import type { SkillDetailResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createSkillDetail,
  createSkillVersion,
  getFileTreeButton,
  getMocks,
  getSourceEditor,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage metadata', () => {
  beforeEach(resetDetailPageFixture)

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
    expect(screen.getByRole('button', { name: 'common.tag.manageTags' })).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    ).not.toBeInTheDocument()
  })

  it('previews selected workspace tags immediately and saves once when the selector closes', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.click(await screen.findByRole('option', { name: 'Search' }))

    expect(
      within(screen.getByRole('region', { name: /skillManagement\.detail\.fileCount/ })).getByText(
        'Search',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getByRole('option', { name: 'Search' })).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.removeTag:{"tag":"Search"}',
      }),
    ).toBeDisabled()
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalled()

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
    expect(mocks.skillMetadataMutationFn).toHaveBeenCalledTimes(1)
  })

  it('previews unchecked tags immediately and saves once when the selector closes', async () => {
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

    const sidebar = within(
      screen.getByRole('region', { name: /skillManagement\.detail\.fileCount/ }),
    )
    expect(sidebar.queryByText('Search')).not.toBeInTheDocument()
    expect(sidebar.getByText('Productivity')).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getByRole('option', { name: 'Search' })).toHaveAttribute('aria-selected', 'false')
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalled()

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
    expect(mocks.skillMetadataMutationFn).toHaveBeenCalledTimes(1)
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

  it('previews a newly created tag immediately and binds it when the selector closes', async () => {
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

    expect(
      within(screen.getByRole('region', { name: /skillManagement\.detail\.fileCount/ })).getByText(
        'BrandNew',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('listbox')).toBeVisible()
    expect(screen.getByRole('option', { name: 'BrandNew' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalled()

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
    expect(mocks.skillMetadataMutationFn).toHaveBeenCalledTimes(1)
  })

  it('keeps selected tags visible and prevents reopening while the metadata request is pending', async () => {
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

    expect(
      within(screen.getByRole('region', { name: /skillManagement\.detail\.fileCount/ })).getByText(
        'Search',
      ),
    ).toBeInTheDocument()
    const addTagButton = screen.getByRole('combobox', {
      name: 'skill.skillManagement.detail.addTag',
    })
    expect(addTagButton).toBeDisabled()
    expect(
      screen.getByRole('button', {
        name: 'skill.skillManagement.detail.removeTag:{"tag":"Search"}',
      }),
    ).toBeDisabled()
    await user.click(addTagButton)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(mocks.skillMetadataMutationFn).toHaveBeenCalledTimes(1)

    await act(async () => {
      const nextDetail = createSkillDetail({
        tags: ['Search'],
        updated_at: 1784638491,
      })
      mocks.skillDetail = nextDetail
      resolveMutation?.(nextDetail)
    })

    expect(await screen.findByText('Search')).toBeInTheDocument()
    expect(addTagButton).toBeEnabled()
  })

  it('restores persisted tags when saving the visible selection fails', async () => {
    const user = userEvent.setup()
    let rejectMutation: ((error: Error) => void) | undefined
    mocks.skillDetailKey.mockReturnValue(['skill-detail'])
    mocks.skillDetailQueryOptions.mockImplementation(() => ({
      queryKey: ['skill-detail'],
      queryFn: async () => mocks.skillDetail,
    }))
    mocks.skillDetail = createSkillDetail({ tags: ['Search'] })
    mocks.skillMetadataMutationFn.mockImplementation(
      () =>
        new Promise<SkillDetailResponse>((_resolve, reject) => {
          rejectMutation = reject
        }),
    )
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    await user.click(await screen.findByRole('option', { name: 'Search' }))
    await user.click(screen.getByRole('option', { name: 'Productivity' }))
    await user.click(screen.getByTestId('skill-detail-sidebar-header'))

    const sidebar = within(
      screen.getByRole('region', { name: /skillManagement\.detail\.fileCount/ }),
    )
    expect(sidebar.queryByText('Search')).not.toBeInTheDocument()
    expect(sidebar.getByText('Productivity')).toBeInTheDocument()

    await act(async () => {
      rejectMutation?.(new Error('Saving tags failed'))
    })

    expect(await sidebar.findByText('Search')).toBeInTheDocument()
    expect(sidebar.queryByText('Productivity')).not.toBeInTheDocument()
    expect(mocks.toastError).toHaveBeenCalledWith('skill.skillManagement.detail.updateTagsFailed')
    await user.click(
      screen.getByRole('combobox', {
        name: 'skill.skillManagement.detail.addTag',
      }),
    )
    expect(await screen.findByRole('option', { name: 'Search' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('option', { name: 'Productivity' })).toHaveAttribute(
      'aria-selected',
      'false',
    )
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

    await user.click(await screen.findByRole('button', { name: 'common.operation.rename' }))
    const renameInput = screen.getByRole('textbox', { name: 'common.operation.rename' })
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveValue('Untitled skill')
    expect(renameInput).toHaveProperty('selectionStart', 0)
    expect(renameInput).toHaveProperty('selectionEnd', 'Untitled skill'.length)
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'skill.skillManagement.detail.renameSkillSuccess',
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.operation.rename' })).toHaveTextContent(
        'Renamed skill',
      )
    })
  })

  it('starts inline rename from the sidebar More menu', async () => {
    const user = userEvent.setup()
    renderSkillDetailPage()

    const moreButton = await screen.findByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
    })
    await user.click(moreButton)
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.rename' }))
    const renameInput = screen.getByRole('textbox', { name: 'common.operation.rename' })
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveValue('Untitled skill')
  })

  it.each(['version-1', null])(
    'opens the returned duplicate for inline rename with published version %s from the sidebar More menu',
    async (publishedVersionId) => {
      const user = userEvent.setup()
      mocks.duplicateSkillMutationFn.mockResolvedValue(createSkillDetail({ id: 'copied-skill' }))
      mocks.skillDetail = createSkillDetail({ latest_published_version_id: publishedVersionId })
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
      expect(mocks.toastSuccess).toHaveBeenCalledWith('skill.skillManagement.duplicateSuccess')
      expect(mocks.routerPush).toHaveBeenCalledWith('/skills/copied-skill?rename=true')
    },
  )

  it('stays on the original detail when duplication fails', async () => {
    const user = userEvent.setup()
    mocks.duplicateSkillMutationFn.mockRejectedValue(new Error('Duplicate failed'))
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'common.operation.duplicate' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('skill.skillManagement.duplicateFailed')
    })
    expect(mocks.routerPush).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'common.operation.rename' })).toHaveTextContent(
      'Untitled skill',
    )
  })

  it.each(['version-1', null])(
    'exports the current skill with published version %s from the sidebar More menu',
    async (publishedVersionId) => {
      const user = userEvent.setup()
      const archive = new Blob(['archive'], { type: 'application/zip' })
      mocks.fetchSkillArchiveBlob.mockResolvedValue(archive)
      mocks.skillDetail = createSkillDetail({ latest_published_version_id: publishedVersionId })
      renderSkillDetailPage()

      await user.click(
        await screen.findByRole('button', {
          name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
        }),
      )
      await user.click(screen.getByRole('menuitem', { name: 'common.operation.export' }))

      await waitFor(() => {
        expect(mocks.fetchSkillArchiveBlob).toHaveBeenCalledWith('skill-1')
        expect(mocks.downloadBlob).toHaveBeenCalledWith({
          data: archive,
          fileName: 'github-actions-failure-debugging.zip',
        })
      })
    },
  )

  it('does not start inline rename on an ordinary detail visit', async () => {
    const { onUrlUpdate } = renderSkillDetailPage()

    expect(
      await screen.findByRole('button', { name: 'common.operation.rename' }),
    ).toHaveTextContent('Untitled skill')
    expect(
      screen.queryByRole('textbox', { name: 'common.operation.rename' }),
    ).not.toBeInTheDocument()
    expect(onUrlUpdate).not.toHaveBeenCalled()
  })

  it('starts inline rename after the copied detail loads and consumes the request once', async () => {
    const user = userEvent.setup()
    let resolveDetail: (detail: SkillDetailResponse) => void = () => {}
    const detailPromise = new Promise<SkillDetailResponse>((resolve) => {
      resolveDetail = resolve
    })
    mocks.skillDetailQueryOptions.mockImplementation((options) => ({
      queryKey: ['skill-detail', options],
      queryFn: () => detailPromise,
    }))
    const { onUrlUpdate, queryClient } = renderSkillDetailPage({
      searchParams: '?rename=true&source=list',
      strict: true,
    })

    expect(
      screen.queryByRole('textbox', { name: 'common.operation.rename' }),
    ).not.toBeInTheDocument()
    expect(onUrlUpdate).not.toHaveBeenCalled()
    await act(async () => resolveDetail(createSkillDetail()))

    const renameInput = await screen.findByRole('textbox', { name: 'common.operation.rename' })
    expect(renameInput).toHaveFocus()
    expect(renameInput).toHaveValue('Untitled skill')
    expect(renameInput).toHaveProperty('selectionStart', 0)
    expect(renameInput).toHaveProperty('selectionEnd', 'Untitled skill'.length)
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('rename')).toBe(false)
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('source')).toBe('list')

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'common.operation.rename' })).toBeInTheDocument()
    await act(async () => queryClient.invalidateQueries())
    expect(
      screen.queryByRole('textbox', { name: 'common.operation.rename' }),
    ).not.toBeInTheDocument()
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalled()
  })

  it('saves the automatically activated name editor without activating it again', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate, queryClient } = renderSkillDetailPage({ searchParams: '?rename=true' })
    const renameInput = await screen.findByRole('textbox', { name: 'common.operation.rename' })

    await user.clear(renameInput)
    await user.type(renameInput, 'Renamed duplicate{Enter}')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.operation.rename' })).toHaveTextContent(
        'Renamed duplicate',
      )
    })
    expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ display_name: 'Renamed duplicate' }),
      }),
      expect.anything(),
    )
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.has('rename')).toBe(false)
    await act(async () => queryClient.invalidateQueries())
    expect(
      screen.queryByRole('textbox', { name: 'common.operation.rename' }),
    ).not.toBeInTheDocument()
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
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
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

  it('keeps the skill timestamp for metadata updates after publishing', async () => {
    const user = userEvent.setup()
    const skillUpdatedAt = 1784638490
    const versionCreatedAt = 1784638491
    mocks.skillDetail = createSkillDetail({ updated_at: skillUpdatedAt })
    mocks.publishSkillMutationFn.mockImplementationOnce(async () => {
      const version = {
        id: 'version-2',
        version_number: 2,
        version_name: '',
        publish_note: '',
        hash_code: 'hash-code',
        archive_size: 180,
        published_by: 'user-1',
        published_by_name: 'Fate',
        created_at: versionCreatedAt,
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
    renderSkillDetailPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.publishUpdate',
      }),
    )
    await waitFor(() => {
      expect(mocks.publishSkillMutationFn).toHaveBeenCalled()
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.rename' }))
    const renameInput = screen.getByRole('textbox', { name: 'common.operation.rename' })
    await user.clear(renameInput)
    await user.type(renameInput, 'Renamed after publish{Enter}')

    await waitFor(() => {
      expect(mocks.skillMetadataMutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            display_name: 'Renamed after publish',
            expected_updated_at: skillUpdatedAt,
          }),
        }),
        expect.anything(),
      )
    })
    expect(mocks.skillMetadataMutationFn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          expected_updated_at: versionCreatedAt,
        }),
      }),
      expect.anything(),
    )
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
    fireEvent.change(ownerValue, { target: { value: 'success' } })
    fireEvent.blur(ownerValue)

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

    fireEvent.click(screen.getByRole('button', { name: 'Remove owner' }))

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
})
