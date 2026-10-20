import type { FileEntity } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransferMethod } from '@/types/app'
import { createFileStore, FileContextProvider, useFileStore, useStore } from '../store'

const createMockFile = (overrides: Partial<FileEntity> = {}): FileEntity => ({
  id: 'file-1',
  name: 'test.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  ...overrides,
})

function FileSelection({ name }: { name: string }) {
  const files = useStore((state) => state.files)
  const store = useFileStore()
  return (
    <section aria-label={name}>
      <output aria-label={`${name} files`}>
        {files.map((file) => file.name).join(', ') || 'Empty'}
      </output>
      <button onClick={() => store.getState().setFiles([])}>Clear {name}</button>
    </section>
  )
}

it('notifies consumers when replacing the selected files', () => {
  const onChange = vi.fn()
  const store = createFileStore([createMockFile()], onChange)
  const replacement = [createMockFile({ id: 'file-2', name: 'next.txt' })]
  store.getState().setFiles(replacement)
  expect(store.getState().files).toEqual(replacement)
  expect(onChange).toHaveBeenCalledExactlyOnceWith(replacement)
})

it('updates subscribers, retains edited selection on rerender, and isolates upload instances', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const view = () => (
    <>
      <FileContextProvider value={[createMockFile()]} onChange={onChange}>
        <FileSelection name="Primary" />
      </FileContextProvider>
      <FileContextProvider value={[createMockFile({ name: 'other.txt' })]}>
        <FileSelection name="Secondary" />
      </FileContextProvider>
    </>
  )
  const { rerender } = render(view())
  expect(screen.getByRole('status', { name: 'Primary files' })).toHaveTextContent('test.txt')
  await user.click(screen.getByRole('button', { name: 'Clear Primary' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith([])
  expect(screen.getByRole('status', { name: 'Primary files' })).toHaveTextContent('Empty')
  expect(screen.getByRole('status', { name: 'Secondary files' })).toHaveTextContent('other.txt')
  rerender(view())
  expect(screen.getByRole('status', { name: 'Primary files' })).toHaveTextContent('Empty')
  expect(screen.getByRole('status', { name: 'Secondary files' })).toHaveTextContent('other.txt')
})
