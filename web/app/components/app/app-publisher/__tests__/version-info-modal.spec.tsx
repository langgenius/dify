import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { VersionInfoModal } from '../version-info-modal'

vi.mock('@/app/notifications', () => ({
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
        open
        versionInfo={{
          id: 'version-1',
          marked_name: 'Release 1',
          marked_comment: 'Initial release',
        }}
        onOpenChange={vi.fn()}
        onPublish={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('Release 1'))!.toBeInTheDocument()
    expect(screen.getByDisplayValue('Initial release'))!.toBeInTheDocument()
  })

  it('should reject overlong titles', () => {
    const handlePublish = vi.fn()

    render(<VersionInfoModal open onOpenChange={vi.fn()} onPublish={handlePublish} />)

    const [titleInput] = screen.getAllByRole('textbox')
    fireEvent.change(titleInput!, { target: { value: 'a'.repeat(16) } })
    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)versionHistory\.editField\.titleLengthLimit(?=$|:)/),
    )
    expect(handlePublish).not.toHaveBeenCalled()
  })

  it('should publish valid values and close the modal', () => {
    const handlePublish = vi.fn()
    const handleClose = vi.fn()

    render(
      <VersionInfoModal
        open
        versionInfo={{
          id: 'version-2',
          marked_name: 'Old title',
          marked_comment: 'Old notes',
        }}
        onOpenChange={handleClose}
        onPublish={handlePublish}
      />,
    )

    const [titleInput, notesInput] = screen.getAllByRole('textbox')
    fireEvent.change(titleInput!, { target: { value: 'Release 2' } })
    fireEvent.change(notesInput!, { target: { value: 'Updated notes' } })
    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))

    expect(handlePublish).toHaveBeenCalledWith({
      title: 'Release 2',
      releaseNotes: 'Updated notes',
      id: 'version-2',
    })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('should close when the dialog requests close', () => {
    const handleClose = vi.fn()

    render(<VersionInfoModal open onOpenChange={handleClose} onPublish={vi.fn()} />)

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('should close when the close button is clicked', () => {
    const handleClose = vi.fn()

    render(<VersionInfoModal open onOpenChange={handleClose} onPublish={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.close(?=$|:)/ }))

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('should validate release note length and clear previous errors before publishing', () => {
    const handlePublish = vi.fn()
    const handleClose = vi.fn()

    render(
      <VersionInfoModal
        open
        versionInfo={{
          id: 'version-3',
          marked_name: 'Old title',
          marked_comment: 'Old notes',
        }}
        onOpenChange={handleClose}
        onPublish={handlePublish}
      />,
    )

    const [titleInput, notesInput] = screen.getAllByRole('textbox')

    fireEvent.change(titleInput!, { target: { value: 'a'.repeat(16) } })
    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)versionHistory\.editField\.titleLengthLimit(?=$|:)/),
    )

    fireEvent.change(titleInput!, { target: { value: 'Release 3' } })
    fireEvent.change(notesInput!, { target: { value: 'b'.repeat(101) } })
    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)versionHistory\.editField\.releaseNotesLengthLimit(?=$|:)/),
    )

    fireEvent.change(notesInput!, { target: { value: 'Stable release notes' } })
    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)operation\.save(?=$|:)/ }))

    expect(handlePublish).toHaveBeenCalledWith({
      title: 'Release 3',
      releaseNotes: 'Stable release notes',
      id: 'version-3',
    })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})

it('discards a canceled draft after exit and initializes the next version', async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  const onPublish = vi.fn()
  const source = { id: 'version-a', marked_name: 'Release A', marked_comment: 'Original notes' }
  const { rerender } = render(
    <VersionInfoModal
      open
      versionInfo={source}
      onOpenChange={onOpenChange}
      onPublish={onPublish}
    />,
  )
  const title = screen.getByRole('textbox', { name: /editField.title$/ })
  await user.clear(title)
  await user.type(title, 'Canceled draft{Enter}')
  expect(onPublish).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
  rerender(
    <VersionInfoModal
      open={false}
      versionInfo={source}
      onOpenChange={onOpenChange}
      onPublish={onPublish}
    />,
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  rerender(
    <VersionInfoModal
      open
      versionInfo={{ id: 'version-b', marked_name: 'Release B', marked_comment: 'Other notes' }}
      onOpenChange={onOpenChange}
      onPublish={onPublish}
    />,
  )
  expect(screen.getByRole('textbox', { name: /editField.title$/ })).toHaveValue('Release B')
  expect(screen.getByRole('textbox', { name: /editField.releaseNotes$/ })).toHaveValue(
    'Other notes',
  )
  expect(
    screen.getByRole('dialog', { name: 'workflowHistory.versionHistory.editVersionInfo' }),
  ).toBeInTheDocument()
})

it('keeps draft fields while reading the current source id for an immediate save', async () => {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  let complete!: () => void
  const onPublish = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  const { rerender } = render(
    <VersionInfoModal
      open
      versionInfo={{ id: 'version-a', marked_name: 'Release A', marked_comment: 'Original notes' }}
      onOpenChange={onOpenChange}
      onPublish={onPublish}
    />,
  )
  await user.clear(screen.getByRole('textbox', { name: /editField.title$/ }))
  await user.type(screen.getByRole('textbox', { name: /editField.title$/ }), 'Edited draft')
  rerender(
    <VersionInfoModal
      open
      versionInfo={{ id: 'version-b', marked_name: '', marked_comment: '' }}
      onOpenChange={onOpenChange}
      onPublish={onPublish}
    />,
  )
  expect(
    screen.getByRole('dialog', { name: 'workflowHistory.versionHistory.nameThisVersion' }),
  ).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onPublish).toHaveBeenCalledExactlyOnceWith({
    id: 'version-b',
    title: 'Edited draft',
    releaseNotes: 'Original notes',
  })
  expect(onOpenChange).toHaveBeenCalledWith(false)
  complete()
})
