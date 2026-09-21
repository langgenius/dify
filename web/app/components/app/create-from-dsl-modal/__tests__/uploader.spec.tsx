import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { toast } from '@/app/notifications'
import { Uploader } from '../uploader'

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

describe('Uploader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getDropZone = (container: HTMLElement) =>
    (container.firstChild as HTMLElement).querySelector('div') as HTMLElement

  const getHiddenInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!

  function ControlledUploader({ initialFile }: { initialFile?: File }) {
    const [file, setFile] = useState<File | undefined>(initialFile)

    return <Uploader file={file} updateFile={setFile} />
  }

  it('should upload a single dropped file', () => {
    const updateFile = vi.fn()
    const file = new File(['name: demo'], 'demo.yml', { type: 'text/yaml' })

    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const dropZone = getDropZone(container)
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [file],
      },
    })

    expect(updateFile).toHaveBeenCalledWith(file)
  })

  it.each(['picker', 'drop'])(
    'rejects an unsupported file from %s and preserves the current state',
    async (source) => {
      const user = userEvent.setup({ applyAccept: false })
      const file = new File(['app: demo'], 'demo.yml')
      const { container } = render(
        <ControlledUploader initialFile={source === 'drop' ? file : undefined} />,
      )
      const invalid = new File(['binary'], 'wrong.zip')
      if (source === 'picker') await user.upload(getHiddenInput(), invalid)
      else fireEvent.drop(getDropZone(container), { dataTransfer: { files: [invalid] } })
      if (source === 'drop')
        expect(screen.getByRole('group', { name: 'demo.yml' })).toBeInTheDocument()
      else
        expect(screen.getByRole('button', { name: 'app.dslUploader.browse' })).toBeInTheDocument()
      expect(screen.queryByText('wrong.zip')).not.toBeInTheDocument()
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining('dslUploader.invalidFileType'),
      )
    },
  )

  it('honors the pipeline extension instead of treating every upload as an App package', () => {
    const updateFile = vi.fn()
    const { container } = render(
      <Uploader file={undefined} updateFile={updateFile} importType="pipeline" />,
    )
    fireEvent.drop(getDropZone(container), {
      dataTransfer: { files: [new File(['PK'], 'agent.ifpkg')] },
    })
    expect(updateFile).not.toHaveBeenCalled()
    const pipeline = new File(['pipeline'], 'knowledge.PIPELINE')
    fireEvent.drop(getDropZone(container), { dataTransfer: { files: [pipeline] } })
    expect(updateFile).toHaveBeenCalledWith(pipeline)
  })

  it('updates App file metadata when replacing a package with DSL', () => {
    const updateFile = vi.fn()
    const { rerender } = render(
      <Uploader importType="app" file={new File(['PK'], 'agent.IFPKG')} updateFile={updateFile} />,
    )
    expect(screen.getByText('app.appPackage')).toBeInTheDocument()

    rerender(
      <Uploader
        importType="app"
        file={new File(['app: demo'], 'app.yml')}
        updateFile={updateFile}
      />,
    )
    expect(screen.getByText('DSL')).toBeInTheDocument()
    expect(screen.queryByText('app.appPackage')).not.toBeInTheDocument()
  })

  it('should reject dropping multiple files', () => {
    const updateFile = vi.fn()
    const fileA = new File(['a'], 'a.yml', { type: 'text/yaml' })
    const fileB = new File(['b'], 'b.yml', { type: 'text/yaml' })

    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const dropZone = getDropZone(container)
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [fileA, fileB],
      },
    })

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/(?:^|\.)stepOne\.uploader\.validation\.count(?=$|:)/),
    )
    expect(updateFile).not.toHaveBeenCalled()
  })

  it('should render the selected file and allow removing it', () => {
    const updateFile = vi.fn()
    const file = new File(['name: demo'], 'demo.yml', { type: 'text/yaml' })

    render(<Uploader file={file} updateFile={updateFile} importType="app" />)

    expect(screen.getByText(/(?:^|\.)demo\.yml(?=$|:)/)).toBeInTheDocument()
    expect(screen.getByText('DSL')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(updateFile).toHaveBeenCalledTimes(1)
  })

  it('should ignore drops without dataTransfer', () => {
    const updateFile = vi.fn()

    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const dropZone = getDropZone(container)
    fireEvent.drop(dropZone)

    expect(updateFile).not.toHaveBeenCalled()
  })

  it('should update the file from the hidden uploader input', () => {
    const updateFile = vi.fn()
    const nextFile = new File(['next'], 'next.yml', { type: 'text/yaml' })

    render(<Uploader file={undefined} updateFile={updateFile} />)

    fireEvent.change(getHiddenInput(), {
      target: {
        files: [nextFile],
      },
    })

    expect(updateFile).toHaveBeenCalledWith(nextFile)
  })

  it('should move keyboard focus to the selected file row before the remove action', async () => {
    const user = userEvent.setup()
    const nextFile = new File(['next'], 'next.yml', { type: 'text/yaml' })
    render(<ControlledUploader />)

    const browseButton = screen.getByRole('button', {
      name: /(?:^|\.)dslUploader\.browse(?=$|:)/,
    })
    browseButton.focus()
    await user.keyboard('{Enter}')
    fireEvent.change(getHiddenInput(), {
      target: {
        files: [nextFile],
      },
    })

    const fileRow = screen.getByRole('group', { name: 'next.yml' })
    const deleteButton = screen.getByRole('button', {
      name: /(?:^|\.)operation\.delete(?=$|:)/,
    })

    expect(fileRow).toHaveFocus()
    await user.tab()
    expect(deleteButton).toHaveFocus()
  })

  it('should preserve focus ownership after selecting a file with a pointer', async () => {
    const user = userEvent.setup()
    const nextFile = new File(['next'], 'next.yml', { type: 'text/yaml' })
    render(<ControlledUploader />)

    await user.click(screen.getByRole('button', { name: /(?:^|\.)dslUploader\.browse(?=$|:)/ }))
    fireEvent.change(getHiddenInput(), {
      target: {
        files: [nextFile],
      },
    })

    expect(screen.getByRole('group', { name: 'next.yml' })).toHaveFocus()
  })

  it('should not move focus when a file is dropped', () => {
    const nextFile = new File(['next'], 'next.yml', { type: 'text/yaml' })
    const { container } = render(
      <>
        <button type="button">Outside</button>
        <ControlledUploader />
      </>,
    )
    const outsideButton = screen.getByRole('button', { name: 'Outside' })
    const uploaderRoot = container.children[1] as HTMLElement
    const dropZone = uploaderRoot.querySelector('input[type="file"]')?.nextElementSibling
    outsideButton.focus()

    fireEvent.drop(dropZone as Element, {
      dataTransfer: {
        files: [nextFile],
      },
    })

    expect(outsideButton).toHaveFocus()
  })

  it('should restore keyboard focus to Browse after removing the file', async () => {
    const user = userEvent.setup()
    const file = new File(['name: demo'], 'demo.yml', { type: 'text/yaml' })
    render(<ControlledUploader initialFile={file} />)

    const deleteButton = screen.getByRole('button', {
      name: /(?:^|\.)operation\.delete(?=$|:)/,
    })
    deleteButton.focus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('button', { name: /(?:^|\.)dslUploader\.browse(?=$|:)/ })).toHaveFocus()
  })

  it('should toggle drag styles and clear them when leaving the overlay', () => {
    const updateFile = vi.fn()
    const { container } = render(<Uploader file={undefined} updateFile={updateFile} />)

    const dropZone = getDropZone(container)

    fireEvent.dragEnter(dropZone, { target: dropZone })
    fireEvent.dragOver(dropZone, { target: dropZone })

    const dragOverlay = container.querySelector('.absolute')
    expect(dragOverlay).toBeInTheDocument()

    fireEvent.dragLeave(dragOverlay as Element, { target: dragOverlay })

    expect(container.querySelector('.absolute')).not.toBeInTheDocument()
  })

  it('should reopen the hidden input and restore the previous file when the picker is cancelled', () => {
    const updateFile = vi.fn()
    render(<Uploader file={undefined} updateFile={updateFile} />)

    const hiddenInput = getHiddenInput()
    const clickSpy = vi.spyOn(hiddenInput, 'click')

    fireEvent.click(screen.getByRole('button', { name: /(?:^|\.)dslUploader\.browse(?=$|:)/ }))

    expect(clickSpy).toHaveBeenCalled()

    hiddenInput.oncancel?.(new Event('cancel'))

    expect(updateFile).toHaveBeenCalledWith(undefined)
  })

  it('should clear the hidden input and remove the selected file', () => {
    const updateFile = vi.fn()
    const file = new File(['name: demo'], 'demo.yml', { type: 'text/yaml' })
    render(<Uploader file={file} updateFile={updateFile} />)

    const hiddenInput = getHiddenInput()
    Object.defineProperty(hiddenInput, 'value', {
      configurable: true,
      value: 'C:\\fakepath\\demo.yml',
      writable: true,
    })

    fireEvent.click(screen.getByRole('button'))

    expect(hiddenInput.value).toBe('')
    expect(updateFile).toHaveBeenCalledTimes(1)
    expect(updateFile.mock.calls[0]).toEqual([])
  })

  it('should clear the current file when the hidden uploader change event has no files', () => {
    const updateFile = vi.fn()
    render(<Uploader file={undefined} updateFile={updateFile} />)

    fireEvent.change(getHiddenInput(), {
      target: {
        files: [],
      },
    })

    expect(updateFile).toHaveBeenCalledWith(undefined)
  })
})
