import type { Props } from '../csv-uploader'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import CSVUploader from '../csv-uploader'

const toastMocks = vi.hoisted(() => ({
  notify: vi.fn(),
  dismiss: vi.fn(),
  update: vi.fn(),
  promise: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: (message: string, options?: Record<string, unknown>) => toastMocks.notify({ type: 'success', message, ...options }),
    error: (message: string, options?: Record<string, unknown>) => toastMocks.notify({ type: 'error', message, ...options }),
    warning: (message: string, options?: Record<string, unknown>) => toastMocks.notify({ type: 'warning', message, ...options }),
    info: (message: string, options?: Record<string, unknown>) => toastMocks.notify({ type: 'info', message, ...options }),
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
    if (!dropZone || !dropZone.parentElement)
      throw new Error('Drop zone not found')
    const dropContainer = dropZone.parentElement as HTMLDivElement
    return { dropZone, dropContainer }
  }

  const renderComponent = (props?: Partial<Props>) => {
    const mergedProps: Props = {
      file: undefined,
      updateFile,
      ...props,
    }
    return render(
      <CSVUploader {...mergedProps} />,

    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the file picker when clicking browse', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    renderComponent()

    fireEvent.click(screen.getByRole('button', { name: 'appAnnotation.batchModal.browse' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    clickSpy.mockRestore()
  })

  it('should toggle dragging styles and upload the dropped file', async () => {
    const file = new File(['content'], 'input.csv', { type: 'text/csv' })
    renderComponent()
    const { dropZone, dropContainer } = getDropElements()

    fireEvent.dragEnter(dropContainer)
    expect(dropZone.className).toContain('border-components-dropzone-border-accent')
    expect(dropZone.className).toContain('bg-components-dropzone-bg-accent')

    fireEvent.drop(dropContainer, { dataTransfer: { files: [file] } })

    await waitFor(() => expect(updateFile).toHaveBeenCalledWith(file))
    expect(dropZone.className).not.toContain('border-components-dropzone-border-accent')
  })

  it('should handle drag over and clear dragging state when leaving through the overlay', () => {
    renderComponent()
    const { dropZone, dropContainer } = getDropElements()

    fireEvent.dragEnter(dropContainer)
    const dragLayer = dropContainer.querySelector('.absolute') as HTMLDivElement

    fireEvent.dragOver(dropContainer)
    fireEvent.dragLeave(dragLayer)

    expect(dropZone.className).not.toContain('border-components-dropzone-border-accent')
    expect(dropZone.className).not.toContain('bg-components-dropzone-bg-accent')
  })

  it('should ignore drop events without dataTransfer', () => {
    renderComponent()
    const { dropContainer } = getDropElements()

    fireEvent.drop(dropContainer)

    expect(updateFile).not.toHaveBeenCalled()
  })

  it('should show an error when multiple files are dropped', async () => {
    const fileA = new File(['a'], 'a.csv', { type: 'text/csv' })
    const fileB = new File(['b'], 'b.csv', { type: 'text/csv' })
    renderComponent()
    const { dropContainer } = getDropElements()

    fireEvent.drop(dropContainer, { dataTransfer: { files: [fileA, fileB] } })

    await waitFor(() => expect(toastMocks.notify).toHaveBeenCalledWith({
      type: 'error',
      message: 'datasetCreation.stepOne.uploader.validation.count',
    }))
    expect(updateFile).not.toHaveBeenCalled()
  })

  it('should propagate file selection changes through input change event', () => {
    const file = new File(['row'], 'selected.csv', { type: 'text/csv' })
    const { container } = renderComponent()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(fileInput, { target: { files: [file] } })

    expect(updateFile).toHaveBeenCalledWith(file)
  })

  it('should render selected file details and allow change/removal', () => {
    const file = new File(['data'], 'report.csv', { type: 'text/csv' })
    const { container } = renderComponent({ file })
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement

    expect(screen.getByText('report')).toBeInTheDocument()
    expect(screen.getByText('.csv')).toBeInTheDocument()

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click')
    fireEvent.click(screen.getByText('datasetCreation.stepOne.uploader.change'))
    expect(clickSpy).toHaveBeenCalled()
    clickSpy.mockRestore()

    const valueSetter = vi.spyOn(fileInput, 'value', 'set')
    const removeTrigger = screen.getByRole('button', { name: /operation\.delete$/ })
    fireEvent.click(removeTrigger)

    expect(updateFile).toHaveBeenCalledWith()
    expect(valueSetter).toHaveBeenCalledWith('')
  })
})
