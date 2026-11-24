import { detectPlatform } from '@tanstack/react-hotkeys'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import MessageTemplateBody from '../components/message-template-body'

function BodyOwner({
  initial = 'Please review this request. ',
  readOnly = false,
}: {
  initial?: string
  readOnly?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <MessageTemplateBody
        nodeId="approval"
        value={value}
        onChange={setValue}
        readOnly={readOnly}
      />
      <output aria-label="Message body value">{value}</output>
    </>
  )
}
const insert = () =>
  page.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.insertRequestURL' })
const inserted = () =>
  page.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.requestURLInserted' })
const editor = () =>
  page.getByRole('textbox', { name: 'workflow.nodes.humanInputV2.template.body' })

beforeEach(async () => {
  onTestFinished(guardUnexpectedFetch())
  await page.viewport(1000, 700)
})

it('inserts one request URL at the end without replacing the unfocused body', async () => {
  await render(<BodyOwner />)
  await insert().dblClick()
  await expect
    .element(page.getByRole('status', { name: 'Message body value' }))
    .toHaveTextContent('Please review this request. {{#url#}}')
  await expect.element(inserted()).toBeDisabled()
  await expect
    .element(editor().getByText('common.promptEditor.requestURL.item.title'))
    .toBeVisible()
})

it('allows insertion again after the URL is removed through the real editor', async () => {
  await render(<BodyOwner initial="Review {{#url#}}" />)
  await expect.element(inserted()).toBeDisabled()
  await editor().click()
  const mod = detectPlatform() === 'mac' ? 'Meta' : 'Control'
  await userEvent.keyboard(`{${mod}>}a{/${mod}}`)
  await userEvent.keyboard('{Backspace}')
  await expect.element(insert()).toBeEnabled()
  await expect
    .element(editor().getByText('common.promptEditor.requestURL.item.title'))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Message body value' }))
    .toBeEmptyDOMElement()
})

it('keeps a read-only body unchanged and insertion unavailable', async () => {
  await render(<BodyOwner readOnly />)
  await expect.element(insert()).toBeDisabled()
  await expect.element(editor()).toHaveAttribute('contenteditable', 'false')
  await expect
    .element(page.getByRole('status', { name: 'Message body value' }))
    .toHaveTextContent('Please review this request.')
})

it('connects validation and guidance to the actual Lexical textbox', async () => {
  await render(
    <MessageTemplateBody
      nodeId="approval"
      value="Review"
      onChange={vi.fn()}
      error="A request URL is required"
    />,
  )
  await expect.element(editor()).toHaveAttribute('aria-invalid', 'true')
  await expect.element(editor()).toHaveAccessibleDescription(/A request URL is required/)
  await expect
    .element(editor())
    .toHaveAccessibleDescription(/workflow.nodes.humanInputV2.template.requestURLHint/)
})
