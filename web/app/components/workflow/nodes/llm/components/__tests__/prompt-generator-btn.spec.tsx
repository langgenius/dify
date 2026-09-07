import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PromptGeneratorBtn from '../prompt-generator-btn'

vi.mock('@/app/components/app/configuration/config/automatic/get-automatic-res', () => ({
  default: () => <div role="dialog" aria-label="prompt generator" />,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowId: string } }) => unknown) =>
    selector({ configsMap: { flowId: 'flow-1' } }),
}))

describe('PromptGeneratorBtn', () => {
  it('should open the prompt generator from the named action', async () => {
    const user = userEvent.setup()
    render(<PromptGeneratorBtn nodeId="node-1" />)

    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))

    expect(screen.getByRole('dialog', { name: 'prompt generator' })).toBeInTheDocument()
  })
})
