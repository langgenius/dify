import type { CustomActionsProps } from '../actions'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { useAppForm } from '../../..'

const TestForm = ({
  invalid = false,
  onSubmit = async () => {},
  CustomActions,
}: {
  invalid?: boolean
  onSubmit?: () => Promise<void>
  CustomActions?: (props: CustomActionsProps) => React.ReactNode
}) => {
  const form = useAppForm({
    defaultValues: { name: '' },
    validators: { onMount: () => (invalid ? 'Name is required' : undefined) },
    onSubmit,
  })
  return (
    <form.AppForm>
      <form.Actions CustomActions={CustomActions} />
    </form.AppForm>
  )
}

describe('Actions', () => {
  it('disables submission when the form is invalid', async () => {
    await render(<TestForm invalid />)
    await expect
      .element(page.getByRole('button', { name: 'common.operation.submit' }))
      .toBeDisabled()
  })

  it('keeps the pending button focusable and prevents duplicate submissions', async () => {
    let finishSubmit!: () => void
    const pending = new Promise<void>((resolve) => {
      finishSubmit = resolve
    })
    const onSubmit = vi.fn(() => pending)
    await render(<TestForm onSubmit={onSubmit} />)
    const button = page.getByRole('button', { name: 'common.operation.submit' })
    await button.click()
    await expect.element(button).toHaveAttribute('aria-disabled', 'true')
    await expect.element(button).not.toHaveAttribute('disabled')
    await expect.element(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledOnce()
    finishSubmit()
    await expect.element(button).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('lets custom actions submit the form and observe pending state', async () => {
    let finish!: () => void
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    await render(
      <TestForm
        onSubmit={onSubmit}
        CustomActions={({ form, isSubmitting, canSubmit }) => (
          <button
            type="button"
            disabled={!canSubmit || isSubmitting}
            onClick={() => form.handleSubmit()}
          >
            {isSubmitting ? 'Saving' : 'Save'}
          </button>
        )}
      />,
    )

    await page.getByRole('button', { name: 'Save' }).click()
    await expect.element(page.getByRole('button', { name: 'Saving' })).toBeDisabled()
    expect(onSubmit).toHaveBeenCalledOnce()
    finish()
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})
