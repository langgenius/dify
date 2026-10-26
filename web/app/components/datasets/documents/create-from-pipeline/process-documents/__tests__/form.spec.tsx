import type { BaseConfiguration } from '@/app/components/base/form/form-scenarios/base/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { z } from 'zod'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import Form from '../form'

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/app/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/notifications')>()
  return { ...actual, toast: { ...actual.toast, error: toastError } }
})
const configurations: BaseConfiguration[] = [
  { variable: 'name', type: 'text-input', label: 'Name', required: true, showConditions: [] },
]
const schema = z.object({ name: z.string().min(1, 'Name is required') })
function Harness({ onSubmit = vi.fn(), onPreview = vi.fn(), isRunning = false }) {
  const ref = useRef<{ submit: () => void }>(null)
  return (
    <>
      <Form
        ref={ref}
        initialData={{ name: 'original' }}
        configurations={configurations}
        schema={schema}
        onSubmit={onSubmit}
        onPreview={onPreview}
        isRunning={isRunning}
      />
      <button onClick={() => ref.current?.submit()}>Process documents</button>
    </>
  )
}

it('submits the edited configuration through the process action and rejects missing required values', async () => {
  const user = userEvent.setup()
  const onSubmit = vi.fn()
  render(<Harness onSubmit={onSubmit} />)
  const name = screen.getByRole('textbox')
  await user.clear(name)
  await user.click(screen.getByRole('button', { name: 'Process documents' }))
  await waitFor(() => expect(toastError).toHaveBeenCalledWith('"name" Name is required'))
  expect(onSubmit).not.toHaveBeenCalled()
  await user.type(name, 'Updated')
  await user.click(screen.getByRole('button', { name: 'Process documents' }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ name: 'Updated' }))
})

it('resets edited configuration and prevents preview while processing', async () => {
  const user = userEvent.setup()
  const onPreview = vi.fn()
  const { rerender } = render(<Harness onPreview={onPreview} />)
  const reset = screen.getByRole('button', { name: 'common.operation.reset' })
  expect(reset).toBeDisabled()
  await user.type(screen.getByRole('textbox'), ' draft')
  await user.click(reset)
  expect(screen.getByRole('textbox')).toHaveValue('original')
  expect(reset).toBeDisabled()
  const preview = screen.getByRole('button', {
    name: 'datasetPipeline.addDocuments.stepTwo.previewChunks',
  })
  await user.click(preview)
  expect(onPreview).toHaveBeenCalledOnce()
  rerender(<Harness onPreview={onPreview} isRunning />)
  expect(preview).toBeDisabled()
  await user.click(preview)
  expect(onPreview).toHaveBeenCalledOnce()
})
