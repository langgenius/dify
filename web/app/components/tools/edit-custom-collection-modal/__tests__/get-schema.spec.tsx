import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { importSchemaFromURL } from '@/service/tools'
import examples from '../examples'
import GetSchema from '../get-schema'

vi.mock('@/service/tools', () => ({ importSchemaFromURL: vi.fn() }))

it('validates the URL, prevents duplicate imports, then applies the fetched schema', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const error = vi.spyOn(toast, 'error').mockReturnValue('invalid-url')
  let resolveImport!: (response: { schema: string }) => void
  vi.mocked(importSchemaFromURL).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveImport = resolve
    }),
  )
  render(<GetSchema onChange={onChange} />)
  await user.click(screen.getByRole('button', { name: 'tools.createTool.importFromUrl' }))
  const input = screen.getByRole('textbox', { name: 'tools.createTool.importFromUrl' })
  const submit = screen.getByRole('button', { name: 'common.operation.ok' })
  expect(submit).toBeDisabled()
  await user.type(input, 'ftp://invalid')
  await user.click(submit)
  expect(error).toHaveBeenCalledWith('tools.createTool.urlError')
  expect(importSchemaFromURL).not.toHaveBeenCalled()
  await user.clear(input)
  await user.type(input, 'https://example.com/schema.json')
  await user.click(submit)
  expect(submit).toHaveAttribute('aria-disabled', 'true')
  await user.click(submit)
  expect(importSchemaFromURL).toHaveBeenCalledExactlyOnceWith('https://example.com/schema.json')
  expect(onChange).not.toHaveBeenCalled()
  await act(async () => resolveImport({ schema: 'fetched-schema' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith('fetched-schema')
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'tools.createTool.importFromUrl' }))
  expect(screen.getByRole('textbox')).toHaveValue('')
  error.mockRestore()
})

it('applies the chosen example schema', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<GetSchema onChange={onChange} />)
  await user.click(screen.getByRole('button', { name: 'tools.createTool.examples' }))
  await user.click(
    screen.getByRole('menuitem', { name: `tools.createTool.exampleOptions.${examples[0].key}` }),
  )
  expect(onChange).toHaveBeenCalledExactlyOnceWith(examples[0].content)
})
