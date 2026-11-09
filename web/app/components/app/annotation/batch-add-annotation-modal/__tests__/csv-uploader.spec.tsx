import type { Props } from '../csv-uploader'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import CSVUploader from '../csv-uploader'

const toastMocks = vi.hoisted(() => ({
  notify: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'success', message, ...options }),
    error: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'error', message, ...options }),
    warning: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'warning', message, ...options }),
    info: (message: string, options?: Record<string, unknown>) =>
      toastMocks.notify({ type: 'info', message, ...options }),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  },
}))

describe('CSVUploader', () => {
  const updateFile = vi.fn()

  const getDropElements = () => {
    const title = screen.getByText('appAnnotation.batchModal.csvUploadTitle')
    const dropZone = title.parentElement?.parentElement as HTMLDivElement | null
    if (!dropZone || !dropZone.parentElement) throw new Error('Drop zone not found')
    const dropContainer = dropZone.parentElement as HTMLDivElement
    return { dropZone, dropContainer }
  }

  const renderComponent = (props?: Partial<Props>) => {
    const mergedProps: Props = {
      file: undefined,
      updateFile,
      ...props,
    }
    return render(<CSVUploader {...mergedProps} />)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the file picker when clicking browse', async () => {
    const user = userEvent.setup()
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderComponent()

    await user.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.browse' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('should upload the dropped file', async () => {
    const file = new File(['content'], 'input.csv', { type: 'text/csv' })
    renderComponent()
    const { dropContainer } = getDropElements()

    fireEvent.dragEnter(dropContainer)

    fireEvent.drop(dropContainer, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(updateFile).toHaveBeenCalledWith(file))
  })

  it('should show an error when multiple files are dropped', async () => {
    const fileA = new File(['a'], 'a.csv', { type: 'text/csv' })
    const fileB = new File(['b'], 'b.csv', { type: 'text/csv' })
    renderComponent()
    const { dropContainer } = getDropElements()

    fireEvent.drop(dropContainer, { dataTransfer: { files: [fileA, fileB] } })

    await waitFor(() =>
      expect(toastMocks.notify).toHaveBeenCalledWith({
        type: 'error',
        message: 'datasetCreation.stepOne.uploader.validation.count',
      }),
    )
    expect(updateFile).not.toHaveBeenCalled()
  })

  it('allows selecting the same file again after removing it', async () => {
    const user = userEvent.setup()
    const file = new File(['data'], 'report.csv', { type: 'text/csv' })
    function ControlledUploader() {
      const [selected, setSelected] = React.useState<File>()
      return (
        <CSVUploader
          file={selected}
          updateFile={(next) => {
            updateFile(next)
            setSelected(next)
          }}
        />
      )
    }
    const { container } = render(<ControlledUploader />)
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await user.upload(input, file)
    expect(screen.getByText('report')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /operation\.delete$/ }))
    expect(screen.queryByText('report')).not.toBeInTheDocument()
    expect(updateFile).toHaveBeenLastCalledWith(undefined)
    await user.upload(input, file)
    expect(screen.getByText('report')).toBeInTheDocument()
    expect(updateFile).toHaveBeenCalledTimes(3)
    expect(updateFile).toHaveBeenLastCalledWith(file)
  })
})
