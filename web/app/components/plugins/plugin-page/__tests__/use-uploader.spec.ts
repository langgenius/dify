import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createElement, useRef } from 'react'
import { useUploader } from '../use-uploader'

const file = new File(['content'], 'test.difypkg', { type: 'application/octet-stream' })

function Uploader({
  onFileChange,
  enabled = true,
}: {
  onFileChange: (file: File | null) => void
  enabled?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { dragging, fileUploader, fileChangeHandle, removeFile } = useUploader({
    onFileChange,
    containerRef,
    enabled,
  })
  return createElement(
    'div',
    { ref: containerRef, 'aria-label': 'Plugin upload', role: 'region' },
    createElement('span', { role: 'status' }, dragging ? 'Drop package here' : 'Choose package'),
    createElement('input', {
      ref: fileUploader,
      type: 'file',
      'aria-label': 'Package',
      disabled: !fileChangeHandle,
      onChange: fileChangeHandle ?? undefined,
    }),
    createElement('button', { disabled: !removeFile, onClick: removeFile ?? undefined }, 'Remove'),
  )
}

it('shows file dragging, ignores text drags and keeps the drop target active over children', () => {
  render(createElement(Uploader, { onFileChange: vi.fn() }))
  const target = screen.getByRole('region')
  fireEvent.dragEnter(target, { dataTransfer: { types: ['text/plain'] } })
  expect(screen.getByRole('status')).toHaveTextContent('Choose package')
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } })
  expect(screen.getByRole('status')).toHaveTextContent('Drop package here')
  const leaveToChild = new MouseEvent('dragleave', {
    bubbles: true,
    relatedTarget: screen.getByLabelText('Package'),
  })
  fireEvent(target, leaveToChild)
  expect(screen.getByRole('status')).toHaveTextContent('Drop package here')
  fireEvent.dragLeave(target, { relatedTarget: document.body })
  expect(screen.getByRole('status')).toHaveTextContent('Choose package')
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } })
  fireEvent.dragLeave(target, { relatedTarget: null })
  expect(screen.getByRole('status')).toHaveTextContent('Choose package')
})

it('prevents browser drag navigation and consumes only the first dropped package', () => {
  const onFileChange = vi.fn()
  render(createElement(Uploader, { onFileChange }))
  const target = screen.getByRole('region')
  const bubble = vi.fn()
  document.body.addEventListener('dragover', bubble)
  try {
    const event = new Event('dragover', { bubbles: true, cancelable: true })
    fireEvent(target, event)
    expect(event.defaultPrevented).toBe(true)
    expect(bubble).not.toHaveBeenCalled()
  } finally {
    document.body.removeEventListener('dragover', bubble)
  }
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } })
  fireEvent.drop(target, { dataTransfer: { files: [file, new File(['other'], 'other.difypkg')] } })
  expect(onFileChange).toHaveBeenCalledExactlyOnceWith(file)
  expect(screen.getByRole('status')).toHaveTextContent('Choose package')
})

it.each([undefined, { files: [] }])(
  'clears dragging without selecting a file for an empty drop (%s)',
  (dataTransfer) => {
    const onFileChange = vi.fn()
    render(createElement(Uploader, { onFileChange }))
    const target = screen.getByRole('region')
    fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } })
    fireEvent.drop(target, { dataTransfer })
    expect(screen.getByRole('status')).toHaveTextContent('Choose package')
    expect(onFileChange).not.toHaveBeenCalled()
  },
)

it('selects, removes and reselects the same file through the real input', async () => {
  const user = userEvent.setup()
  const onFileChange = vi.fn()
  render(createElement(Uploader, { onFileChange }))
  const input = screen.getByLabelText('Package') as HTMLInputElement
  await user.upload(input, file)
  expect(onFileChange).toHaveBeenLastCalledWith(file)
  await user.click(screen.getByRole('button', { name: 'Remove' }))
  expect(onFileChange).toHaveBeenLastCalledWith(null)
  expect(input.value).toBe('')
  await user.upload(input, file)
  expect(onFileChange).toHaveBeenCalledTimes(3)
  expect(onFileChange).toHaveBeenLastCalledWith(file)
  fireEvent.change(input, { target: { files: [] } })
  expect(onFileChange).toHaveBeenLastCalledWith(null)
})

it('ignores dragging and drops while disabled, then enables the upload controls', () => {
  const onFileChange = vi.fn()
  const { rerender } = render(createElement(Uploader, { onFileChange, enabled: false }))
  const target = screen.getByRole('region')
  fireEvent.dragEnter(target, { dataTransfer: { types: ['Files'] } })
  fireEvent.drop(target, { dataTransfer: { files: [file] } })
  expect(screen.getByRole('status')).toHaveTextContent('Choose package')
  expect(screen.getByLabelText('Package')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()
  expect(onFileChange).not.toHaveBeenCalled()
  rerender(createElement(Uploader, { onFileChange }))
  fireEvent.drop(target, { dataTransfer: { files: [file] } })
  expect(onFileChange).toHaveBeenCalledExactlyOnceWith(file)
})

it('stops responding to drops after the hook unmounts', () => {
  const containerRef = { current: document.createElement('div') }
  const onFileChange = vi.fn()
  const { unmount } = renderHook(() => useUploader({ containerRef, onFileChange }))
  unmount()
  act(() => fireEvent.drop(containerRef.current, { dataTransfer: { files: [file] } }))
  expect(onFileChange).not.toHaveBeenCalled()
})
