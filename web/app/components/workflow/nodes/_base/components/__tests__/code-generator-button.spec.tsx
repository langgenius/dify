import type { GenRes } from '@/service/debug'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import CodeGenerateBtn from '../code-generator-button'

vi.mock('@/app/components/app/configuration/config/code-generator/get-code-generator-res', () => ({
  GetCodeGeneratorResModal: ({ onFinished }: { onFinished: (result: GenRes) => void }) => (
    <div role="dialog" aria-label="code generator">
      <button type="button" onClick={() => onFinished({ modified: 'print("hello")' })}>
        Apply generated code
      </button>
    </div>
  ),
}))

describe('CodeGenerateBtn', () => {
  it('applies generated code and closes the generator', async () => {
    const user = userEvent.setup()
    const onGenerated = vi.fn()
    render(
      <CodeGenerateBtn
        nodeId="node-1"
        codeLanguages={CodeLanguage.python3}
        onGenerated={onGenerated}
      />,
      {
        resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      },
    )

    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))

    await user.click(screen.getByRole('button', { name: 'Apply generated code' }))
    expect(onGenerated).toHaveBeenCalledExactlyOnceWith('print("hello")')
    expect(screen.queryByRole('dialog', { name: 'code generator' })).not.toBeInTheDocument()
  })
})
