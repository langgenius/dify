import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { createDeferred } from '@/test/deferred'
import {
  createSkillDetail,
  getMocks,
  getSourceEditor,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

async function exportFromSidebar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole('button', {
      name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
    }),
  )
  await user.click(screen.getByRole('menuitem', { name: 'common.operation.export' }))
}

describe('SkillDetailPage export with unsaved content', () => {
  beforeEach(resetDetailPageFixture)

  it.each([false, true])(
    'waits for the latest draft before export (autosave started: %s)',
    async (autosaveStarted) => {
      const user = userEvent.setup()
      const initial = createSkillDetail()
      const file = initial.files![0]!
      const content = `${file.content}\nLatest instructions`
      const save = createDeferred<ReturnType<typeof createSkillDetail>>()
      mocks.skillDetail = initial
      mocks.saveDraftFileMutationFn.mockReturnValue(save.promise)
      mocks.fetchSkillArchiveBlob.mockResolvedValue(new Blob(['archive']))
      renderSkillDetailPage()
      await user.click(
        await screen.findByRole('button', {
          name: 'skill.skillManagement.detail.markdownSourceMode',
        }),
      )
      fireEvent.change(getSourceEditor(), { target: { value: content } })
      if (autosaveStarted) {
        await waitFor(() => expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledOnce(), {
          timeout: 2500,
        })
      }

      await exportFromSidebar(user)
      expect(mocks.fetchSkillArchiveBlob).not.toHaveBeenCalled()
      expect(mocks.downloadBlob).not.toHaveBeenCalled()
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledOnce()
      expect(mocks.saveDraftFileMutationFn.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          body: expect.objectContaining({ content }),
        }),
      )

      await act(async () => {
        save.resolve(
          createSkillDetail({
            updated_at: initial.updated_at + 1,
            files: [{ ...file, content }],
          }),
        )
      })
      await waitFor(() => expect(mocks.fetchSkillArchiveBlob).toHaveBeenCalledWith('skill-1'))
      expect(mocks.downloadBlob).toHaveBeenCalledOnce()
      expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledOnce()
    },
  )

  it('flushes newer edits made while an earlier save is pending', async () => {
    const user = userEvent.setup()
    const initial = createSkillDetail()
    const file = initial.files![0]!
    const firstContent = `${file.content}\nFirst edit`
    const latestContent = `${firstContent}\nLatest edit`
    const firstSave = createDeferred<ReturnType<typeof createSkillDetail>>()
    mocks.skillDetail = initial
    mocks.saveDraftFileMutationFn.mockReturnValueOnce(firstSave.promise).mockResolvedValue(
      createSkillDetail({
        updated_at: initial.updated_at + 2,
        files: [{ ...file, content: latestContent }],
      }),
    )
    mocks.fetchSkillArchiveBlob.mockResolvedValue(new Blob(['archive']))
    renderSkillDetailPage()
    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    fireEvent.change(getSourceEditor(), { target: { value: firstContent } })
    await waitFor(() => expect(mocks.saveDraftFileMutationFn).toHaveBeenCalledOnce(), {
      timeout: 2500,
    })
    fireEvent.change(getSourceEditor(), { target: { value: latestContent } })
    await exportFromSidebar(user)
    expect(mocks.fetchSkillArchiveBlob).not.toHaveBeenCalled()

    await act(async () => {
      firstSave.resolve(
        createSkillDetail({
          updated_at: initial.updated_at + 1,
          files: [{ ...file, content: firstContent }],
        }),
      )
    })
    await waitFor(() => expect(mocks.fetchSkillArchiveBlob).toHaveBeenCalledWith('skill-1'))
    expect(mocks.saveDraftFileMutationFn.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        body: expect.objectContaining({ content: latestContent }),
      }),
    )
    expect(mocks.downloadBlob).toHaveBeenCalledOnce()
  })

  it('does not export stale content when saving fails', async () => {
    const user = userEvent.setup()
    mocks.saveDraftFileMutationFn.mockRejectedValue(new Error('Save failed'))
    mocks.fetchSkillArchiveBlob.mockResolvedValue(new Blob(['stale archive']))
    renderSkillDetailPage()
    await user.click(
      await screen.findByRole('button', {
        name: 'skill.skillManagement.detail.markdownSourceMode',
      }),
    )
    fireEvent.change(getSourceEditor(), { target: { value: '# Unsaved instructions' } })

    await exportFromSidebar(user)
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled(), { timeout: 2500 })
    expect(mocks.fetchSkillArchiveBlob).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })
})
