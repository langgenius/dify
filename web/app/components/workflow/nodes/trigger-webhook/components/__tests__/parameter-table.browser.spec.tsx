import type { WebhookParameter } from '../../types'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { VarType } from '@/app/components/workflow/types'
import ParameterTable from '../parameter-table'

function Editor({ initial, contentType }: { initial: WebhookParameter[]; contentType: string }) {
  const [parameters, setParameters] = useState(initial)
  return (
    <ParameterTable
      title="Body"
      parameters={parameters}
      onChange={setParameters}
      contentType={contentType}
    />
  )
}

it('retains a selected JSON type while changing the required flag', async () => {
  const screen = await render(
    <Editor
      initial={[{ name: 'page', type: VarType.string, required: false }]}
      contentType="application/json"
    />,
  )
  const type = screen.getByRole('combobox').first()
  await type.click()
  const number = screen.getByRole('option', { name: 'Number' })
  await number.click()
  await expect.element(type).toHaveFocus()
  await expect.element(type).toHaveTextContent('Number')
  await userEvent.tab()
  const required = screen
    .getByRole('checkbox', {
      name: 'workflowIntegrations.nodes.triggerWebhook.required',
    })
    .first()
  await expect.element(required).toHaveFocus()
  await userEvent.keyboard(' ')
  await expect.element(required).toBeChecked()
  await expect.element(type).toHaveTextContent('Number')
  await expect.element(screen.getByRole('textbox').first()).toHaveValue('page')
})

it('normalizes a plain-text body to its first string parameter when edited', async () => {
  const screen = await render(
    <Editor
      initial={[
        { name: 'message', type: VarType.number, required: false },
        { name: 'extra', type: VarType.string, required: false },
      ]}
      contentType="text/plain"
    />,
  )
  const required = screen.getByRole('checkbox').first()
  await required.click()
  await expect.element(required).toBeChecked()
  await expect.element(screen.getByRole('textbox').first()).toHaveValue('message')
  await expect.element(screen.getByRole('textbox').nth(1)).toHaveValue('')
  await expect.element(screen.getByRole('combobox').first()).toHaveTextContent('String')
})
