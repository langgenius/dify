import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportFromTool from '../import-from-tool'

vi.mock('../../../../../block-selector', () => ({
  __esModule: true,
  default: ({
    onSelect,
  }: {
    onSelect: (type: string, toolInfo?: unknown) => void
  }) => (
    <div>
      <button type="button" onClick={() => onSelect('tool', undefined)}>select-missing-tool</button>
      <button
        type="button"
        onClick={() => onSelect('tool', {
          provider_id: 'provider-1',
          provider_type: 'unsupported',
          tool_name: 'search',
        })}
      >
        select-unsupported-tool
      </button>
    </div>
  ),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

describe('parameter-extractor/extract-parameter/import-from-tool branches', () => {
  it('ignores missing and unsupported tool payloads', async () => {
    const user = userEvent.setup()
    const handleImport = vi.fn()

    render(<ImportFromTool onImport={handleImport} />)

    await user.click(screen.getByRole('button', { name: 'select-missing-tool' }))
    expect(handleImport).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'select-unsupported-tool' }))

    expect(handleImport).toHaveBeenCalledWith([])
  })
})
