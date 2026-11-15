import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import MailBodyInput from '../mail-body-input'

it('renders saved node and system references and replaces them when the caller loads a flow without Start', async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
  const originalNodes = [
    createNode({ id: 'start', data: { title: 'Start Node', type: BlockEnum.Start } }),
    createNode({ id: 'answer', data: { title: 'Answer Node', type: BlockEnum.Answer } }),
  ]
  const triggerNodes = [createNode({ id: 'llm', data: { title: 'LLM Node', type: BlockEnum.LLM } })]
  function Caller() {
    const [triggerFlow, setTriggerFlow] = useState(false)
    return (
      <>
        <MailBodyInput
          availableNodes={triggerFlow ? triggerNodes : originalNodes}
          value={triggerFlow ? '{{#llm.text#}}' : '{{#answer.answer#}} {{#sys.query#}}'}
        />
        <button type="button" onClick={() => setTriggerFlow(true)}>
          Load trigger workflow
        </button>
      </>
    )
  }
  await renderWorkflowBrowserComponent(<Caller />, { initialStoreState: { nodes: originalNodes } })
  const editor = page.getByRole('textbox')
  await expect.element(editor.getByText('Answer Node')).toBeVisible()
  await expect.element(editor.getByText('answer', { exact: true })).toBeVisible()
  await expect.element(editor.getByText('workflow.blocks.start')).toBeVisible()
  await expect.element(editor.getByText('query', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Load trigger workflow' }).click()
  await expect.element(editor.getByText('LLM Node')).toBeVisible()
  await expect.element(editor.getByText('text', { exact: true })).toBeVisible()
  await expect.element(editor.getByText('Answer Node')).not.toBeInTheDocument()
  await expect.element(editor.getByText('workflow.blocks.start')).not.toBeInTheDocument()
})
