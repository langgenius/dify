import type { LLMNodeType } from '../../types'
import { useState } from 'react'
import { render } from 'vitest-browser-react'
import { BlockEnum } from '@/app/components/workflow/types'
import PanelOutputSection from '../panel-output-section'

const inputs: LLMNodeType = {
  title: 'LLM',
  desc: '',
  type: BlockEnum.LLM,
  model: { provider: 'openai', name: 'gpt-4o', mode: 'chat', completion_params: {} },
  prompt_template: [],
  context: { enabled: false, variable_selector: [] },
  vision: { enabled: false },
  structured_output_enabled: false,
}

function OutputPanel() {
  const [collapsed, setCollapsed] = useState(true)

  return (
    <PanelOutputSection
      inputs={inputs}
      readOnly
      isModelSupportStructuredOutput={false}
      structuredOutputCollapsed={collapsed}
      setStructuredOutputCollapsed={setCollapsed}
      handleStructureOutputEnableChange={vi.fn()}
      handleStructureOutputChange={vi.fn()}
    />
  )
}

it('shows the model finish reason when opening the LLM output variables', async () => {
  const screen = await render(<OutputPanel />)
  const finishReason = screen.getByText('finish_reason', { exact: true })

  await expect.element(finishReason).not.toBeInTheDocument()
  await screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }).click()
  await expect.element(finishReason).toBeVisible()
})
