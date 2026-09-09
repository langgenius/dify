import { render } from 'vitest-browser-react'
import MemoryConfig from '../memory-config'

it('keeps role inputs at their existing size and makes their visible labels focus them', async () => {
  // Browser layout catches flex sizing changes when the legacy input wrapper is removed.
  const screen = await render(
    <div style={{ width: 446 }}>
      <MemoryConfig
        readonly={false}
        canSetRoleName
        config={{
          data: {
            window: { enabled: true, size: 100 },
            role_prefix: { user: 'Human', assistant: 'Assistant' },
            query_prompt_template: '',
          },
        }}
        onChange={() => {}}
      />
    </div>,
  )
  for (const role of ['user', 'assistant']) {
    const input = screen.getByRole('textbox', { name: `workflow.nodes.common.memory.${role}` })
    const rect = input.element().getBoundingClientRect()
    expect(rect.width).toBe(200)
    expect(rect.height).toBe(32)
    await screen.getByText(`workflow.nodes.common.memory.${role}`, { exact: true }).click()
    await expect.element(input).toHaveFocus()
  }
})
