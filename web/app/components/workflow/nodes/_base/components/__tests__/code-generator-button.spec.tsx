import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import CodeGenerateBtn from '../code-generator-button'

vi.mock('@/app/components/app/configuration/config/code-generator/get-code-generator-res', () => ({
  GetCodeGeneratorResModal: () => <div role="dialog" aria-label="code generator" />,
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { configsMap: { flowId: string } }) => unknown) =>
    selector({ configsMap: { flowId: 'flow-1' } }),
}))

describe('CodeGenerateBtn', () => {
  it('should open the code generator from the named action', async () => {
    const user = userEvent.setup()
    render(<CodeGenerateBtn nodeId="node-1" codeLanguages={CodeLanguage.python3} />)

    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))

    expect(screen.getByRole('dialog', { name: 'code generator' })).toBeInTheDocument()
  })
})
