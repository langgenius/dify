import { fireEvent, render, screen } from '@testing-library/react'
import { VarType } from '@/app/components/workflow/types'
import DefaultValue from '../default-value'
vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value: string }) => (
    <textarea aria-label="JSON value" value={value} readOnly />
  ),
}))
it('renders an editable boolean checkbox and array-boolean JSON editor', () => {
  const onFormChange = vi.fn()
  render(
    <DefaultValue
      forms={[
        { key: 'flag', type: VarType.boolean, value: false },
        { key: 'flags', type: VarType.arrayBoolean, value: '[]' },
      ]}
      onFormChange={onFormChange}
    />,
  )
  fireEvent.click(screen.getByRole('checkbox', { name: 'flag' }))
  expect(onFormChange).toHaveBeenCalledWith({ key: 'flag', type: VarType.boolean, value: true })
  expect((screen.getByLabelText('JSON value') as HTMLTextAreaElement).value).toBe('[]')
})
