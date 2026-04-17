/* eslint-disable ts/no-explicit-any */
import { fireEvent, render, screen } from '@testing-library/react'
import { toast } from '@/app/components/base/ui/toast'
import VersionInfoModal from '../version-info-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('VersionInfoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should prefill the fields from the current version info', () => {
    render(
      <VersionInfoModal
        isOpen
        versionInfo={{
          id: 'version-1',
          marked_name: 'Release 1',
          marked_comment: 'Initial release',
        } as any}
        onClose={vi.fn()}
        onPublish={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('Release 1'))!.toBeInTheDocument()
    expect(screen.getByDisplayValue('Initial release'))!.toBeInTheDocument()
  })

  it('should reject overlong titles', () => {
    const handlePublish = vi.fn()

    render(
      <VersionInfoModal
        isOpen
        onClose={vi.fn()}
        onPublish={handlePublish}
      />,
    )

    const [titleInput] = screen.getAllByRole('textbox')
    fireEvent.change(titleInput!, { target: { value: 'a'.repeat(16) } })
    fireEvent.click(screen.getByRole('button', { name: 'common.publish' }))

    expect(toast.error).toHaveBeenCalledWith('versionHistory.editField.titleLengthLimit')
    expect(handlePublish).not.toHaveBeenCalled()
  })

  it('should publish valid values and close the modal', () => {
    const handlePublish = vi.fn()
    const handleClose = vi.fn()

    render(
      <VersionInfoModal
        isOpen
        versionInfo={{
          id: 'version-2',
          marked_name: 'Old title',
          marked_comment: 'Old notes',
        } as any}
        onClose={handleClose}
        onPublish={handlePublish}
      />,
    )

    const [titleInput, notesInput] = screen.getAllByRole('textbox')
    fireEvent.change(titleInput!, { target: { value: 'Release 2' } })
    fireEvent.change(notesInput!, { target: { value: 'Updated notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.publish' }))

    expect(handlePublish).toHaveBeenCalledWith({
      title: 'Release 2',
      releaseNotes: 'Updated notes',
      id: 'version-2',
    })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('should validate release note length and clear previous errors before publishing', () => {
    const handlePublish = vi.fn()
    const handleClose = vi.fn()

    render(
      <VersionInfoModal
        isOpen
        versionInfo={{
          id: 'version-3',
          marked_name: 'Old title',
          marked_comment: 'Old notes',
        } as any}
        onClose={handleClose}
        onPublish={handlePublish}
      />,
    )

    const [titleInput, notesInput] = screen.getAllByRole('textbox')

    fireEvent.change(titleInput!, { target: { value: 'a'.repeat(16) } })
    fireEvent.click(screen.getByRole('button', { name: 'common.publish' }))
    expect(toast.error).toHaveBeenCalledWith('versionHistory.editField.titleLengthLimit')

    fireEvent.change(titleInput!, { target: { value: 'Release 3' } })
    fireEvent.change(notesInput!, { target: { value: 'b'.repeat(101) } })
    fireEvent.click(screen.getByRole('button', { name: 'common.publish' }))
    expect(toast.error).toHaveBeenCalledWith('versionHistory.editField.releaseNotesLengthLimit')

    fireEvent.change(notesInput!, { target: { value: 'Stable release notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'common.publish' }))

    expect(handlePublish).toHaveBeenCalledWith({
      title: 'Release 3',
      releaseNotes: 'Stable release notes',
      id: 'version-3',
    })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
