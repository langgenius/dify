import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  createSkillDetail,
  getLiveMarkdownEditor,
  getMocks,
  getSourceEditor,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('SkillDetailPage autosave', () => {
  beforeEach(resetDetailPageFixture)

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
        expect(mocks.toastError).toHaveBeenCalledWith('skill.skillManagement.detail.saveFailed')
      },
      { timeout: 4000 },
    )
    expect(screen.getByText(/skill\.skillManagement\.detail\.saveFailed/)).toBeInTheDocument()
  })

  it('stops autosaving unchanged content after a non-conflict save failure', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockRejectedValue(new Error('save failed'))

    renderSkillDetailPage()
    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )

    const sourceEditor = getSourceEditor()
    vi.useFakeTimers()
    try {
      fireEvent.change(sourceEditor, {
        target: { value: `${sourceEditor.value}\nMy failing save changes` },
      })
      await act(() => vi.advanceTimersByTimeAsync(1000))

      expect(mocks.toastError).toHaveBeenCalledWith('skill.skillManagement.detail.saveFailed')
      expect(screen.getByText(/skill\.skillManagement\.detail\.saveFailed/)).toBeInTheDocument()

      await act(() => vi.advanceTimersByTimeAsync(2200))
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(1)

      fireEvent.change(sourceEditor, {
        target: { value: `${sourceEditor.value}\nRetry after another edit` },
      })
      await act(() => vi.advanceTimersByTimeAsync(1000))
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  }, 10000)
})
