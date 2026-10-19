import type { GenRes } from '@/service/debug'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderEditor as render } from '@/app/components/workflow/editor-resource/__tests__/render'
import PromptGeneratorBtn from '../prompt-generator-btn'

vi.mock('@/app/components/app/configuration/config/automatic/get-automatic-res', () => ({
  default: ({ onFinished }: { onFinished: (result: GenRes) => void }) => (
    <div role="dialog" aria-label="prompt generator">
      <button type="button" onClick={() => onFinished({ modified: 'Generated prompt' })}>
        Apply generated prompt
      </button>
    </div>
  ),
}))

describe('PromptGeneratorBtn', () => {
  it('applies generated text and closes the generator', async () => {
    const user = userEvent.setup()
    const onGenerated = vi.fn()
    render(<PromptGeneratorBtn nodeId="node-1" onGenerated={onGenerated} />, {
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
    })

    await user.click(screen.getByRole('button', { name: 'appDebug.operation.automatic' }))

    await user.click(screen.getByRole('button', { name: 'Apply generated prompt' }))
    expect(onGenerated).toHaveBeenCalledExactlyOnceWith('Generated prompt')
    expect(screen.queryByRole('dialog', { name: 'prompt generator' })).not.toBeInTheDocument()
  })
})
