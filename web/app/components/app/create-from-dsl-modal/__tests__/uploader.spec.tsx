import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import Uploader from '../uploader'

const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('toast-error')

describe('Uploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the empty state and trigger the file dialog', () => {
    render(<Uploader file={undefined} updateFile={vi.fn()} />)

    expect(screen.getByText('app.dslUploader.button')).toBeInTheDocument()
    expect(screen.getByText('app.dslUploader.browse')).toBeInTheDocument()
  })

  it('should render the selected file and allow removal', () => {
    const updateFile = vi.fn()
    const file = new File(['yaml'], 'demo.yml', { type: 'text/yaml' })

    render(<Uploader file={file} updateFile={updateFile} />)

    expect(screen.getByText('demo.yml')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(updateFile).toHaveBeenCalledTimes(1)
  })

  it('should reject dropping more than one file', async () => {
    const updateFile = vi.fn()
    const firstFile = new File(['one'], 'one.yml', { type: 'text/yaml' })
    const secondFile = new File(['two'], 'two.yml', { type: 'text/yaml' })

    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const dropZone = container.querySelector('input + div')
    expect(dropZone).not.toBeNull()

    fireEvent.drop(dropZone as Element, {
      dataTransfer: {
        files: [firstFile, secondFile],
      },
    })

    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalledTimes(1)
    })
    expect(updateFile).not.toHaveBeenCalled()
  })

  it('should toggle drag state and accept a single dropped file', () => {
    const updateFile = vi.fn()
    const droppedFile = new File(['content'], 'single.yml', { type: 'text/yaml' })
    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const dropZone = container.querySelector('input + div') as Element

    fireEvent.dragEnter(dropZone)
    expect(dropZone.firstElementChild).toHaveClass('border-components-dropzone-border-accent')

    const dragMask = dropZone.querySelector('.absolute') as Element
    fireEvent.dragLeave(dragMask)
    expect(dropZone.firstElementChild).not.toHaveClass('border-components-dropzone-border-accent')

    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [droppedFile],
      },
    })

    expect(updateFile).toHaveBeenCalledWith(droppedFile)
  })

  it('should restore the selection flow on cancel and update the file from the hidden input', () => {
    const updateFile = vi.fn()
    const nextFile = new File(['yaml'], 'next.yml', { type: 'text/yaml' })
    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByText('app.dslUploader.browse'))
    expect(clickSpy).toHaveBeenCalledTimes(1)

    fileInput.oncancel?.(new Event('cancel'))
    expect(updateFile).toHaveBeenCalledWith(undefined)

    fireEvent.change(fileInput, {
      target: {
        files: [nextFile],
      },
    })

    expect(updateFile).toHaveBeenCalledWith(nextFile)
  })
})
