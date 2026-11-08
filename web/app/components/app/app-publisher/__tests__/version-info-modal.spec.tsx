import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import VersionInfoModal from '../version-info-modal'

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('VersionInfoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should validate release note length and clear previous errors before publishing', async () => {
    const user = userEvent.setup()
    const handlePublish = vi.fn()
    const handleClose = vi.fn()

    render(
      <VersionInfoModal
        isOpen
        versionInfo={{
          id: 'version-3',
          marked_name: 'Old title',
          marked_comment: 'Old notes',
        }}
        onClose={handleClose}
        onPublish={handlePublish}
      />,
    )

    const titleInput = screen.getByRole('textbox', { name: /editField\.title$/ })
    const notesInput = screen.getByRole('textbox', { name: /editField\.releaseNotes$/ })
    expect(titleInput).toHaveValue('Old title')
    expect(notesInput).toHaveValue('Old notes')

    await user.clear(titleInput)
    await user.type(titleInput, 'a'.repeat(16))
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)versionHistory\.editField\.titleLengthLimit(?=$|:)/),
    )

    expect(handlePublish).not.toHaveBeenCalled()
    expect(handleClose).not.toHaveBeenCalled()
    await user.clear(titleInput)
    await user.type(titleInput, 'Release 3')
    await user.clear(notesInput)
    await user.type(notesInput, 'b'.repeat(101))
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)versionHistory\.editField\.releaseNotesLengthLimit(?=$|:)/),
    )

    expect(handlePublish).not.toHaveBeenCalled()
    expect(handleClose).not.toHaveBeenCalled()
    await user.clear(notesInput)
    await user.type(notesInput, 'Stable release notes')
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))

    expect(handlePublish).toHaveBeenCalledWith({
      title: 'Release 3',
      releaseNotes: 'Stable release notes',
      id: 'version-3',
    })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
  it.each(['escape', 'close', 'cancel'])('dismisses with %s without publishing', async (action) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onPublish = vi.fn()
    render(<VersionInfoModal isOpen onClose={onClose} onPublish={onPublish} />)
    if (action === 'escape') await user.keyboard('{Escape}')
    else
      await user.click(screen.getByRole('button', { name: new RegExp(`operation\\.${action}$`) }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPublish).not.toHaveBeenCalled()
  })
})
