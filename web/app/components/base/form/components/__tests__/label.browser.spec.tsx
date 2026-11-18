import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import Label from '../label'

function FieldLabel({
  isRequired = false,
  showOptional = false,
  tooltip,
}: {
  isRequired?: boolean
  showOptional?: boolean
  tooltip?: string
}) {
  return (
    <div>
      <Label
        htmlFor="test-input"
        label="Test Label"
        isRequired={isRequired}
        showOptional={showOptional}
        tooltip={tooltip}
      />
      <input id="test-input" />
    </div>
  )
}

describe('Label', () => {
  it('focuses its optional field and exposes the explanation from the keyboard', async () => {
    await render(<FieldLabel showOptional tooltip="Test Tooltip" />)

    const input = page.getByRole('textbox', { name: 'Test Label' })
    await page.getByText('Test Label').click()
    await expect.element(input).toHaveFocus()
    await expect.element(page.getByText('common.label.optional')).toBeVisible()

    await userEvent.tab({ shift: true })
    const explanation = page.getByRole('button', { name: 'Test Label' })
    await expect.element(explanation).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const dialog = page.getByRole('dialog', { name: 'Test Label' })
    await expect.element(dialog).toHaveTextContent('Test Tooltip')
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(explanation).toHaveFocus()
  })

  it('shows the required marker instead of the optional label without breaking association', async () => {
    await render(<FieldLabel isRequired showOptional />)

    await expect.element(page.getByText('common.label.optional')).not.toBeInTheDocument()
    await expect.element(page.getByText('*')).toBeVisible()
    await page.getByText('Test Label').click()
    await expect.element(page.getByRole('textbox', { name: 'Test Label' })).toHaveFocus()
  })
})
