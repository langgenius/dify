import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { useAppForm } from '../index'

const FormHarness = ({ onSubmit }: { onSubmit: (value: Record<string, unknown>) => void }) => {
  const form = useAppForm({
    defaultValues: { title: 'Initial title' },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.AppField name="title" children={(field) => <field.TextField label="Title" />} />
      <form.AppForm>
        <button type="submit">Submit</button>
      </form.AppForm>
    </form>
  )
}

describe('app form field integration', () => {
  it('should submit values through the generated app form', async () => {
    const onSubmit = vi.fn()

    await render(<FormHarness onSubmit={onSubmit} />)

    const input = page.getByRole('textbox', { name: 'Title' })
    await input.fill('')
    await input.fill('Updated title')
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => onSubmit.mock.calls).toEqual([[{ title: 'Updated title' }]])
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
