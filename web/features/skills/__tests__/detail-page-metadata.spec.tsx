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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('skill.skillManagement.duplicateSuccess')

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
