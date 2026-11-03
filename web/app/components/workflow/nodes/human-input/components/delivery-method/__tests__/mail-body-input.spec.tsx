import { screen, within } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import MailBodyInput from '../mail-body-input'

it('shows the originating node and system alias for saved email variable references', async () => {
  const nodes = [
    createNode({ id: 'start', data: { title: 'Start Node', type: BlockEnum.Start } }),
    createNode({ id: 'answer', data: { title: 'Answer Node', type: BlockEnum.Answer } }),
  ]
  renderWorkflowEditor(
    <MailBodyInput availableNodes={nodes} value="{{#answer.answer#}} {{#sys.query#}}" />,
    { nodes },
  )
  const editor = within(screen.getByRole('textbox'))
  expect(await editor.findByText('Answer Node')).toBeVisible()
  expect(editor.getByText('answer')).toBeVisible()
  expect(editor.getByText('workflow.blocks.start')).toBeVisible()
  expect(editor.getByText('query')).toBeVisible()
})

it('resolves node references in flows without a Start node', async () => {
  const nodes = [createNode({ id: 'llm', data: { title: 'LLM Node', type: BlockEnum.LLM } })]
  renderWorkflowEditor(<MailBodyInput availableNodes={nodes} value="{{#llm.text#}}" />, { nodes })
  const editor = within(screen.getByRole('textbox'))
  expect(await editor.findByText('LLM Node')).toBeVisible()
  expect(editor.getByText('text')).toBeVisible()
})
