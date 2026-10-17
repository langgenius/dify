import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FieldInfo from '../field-info'

vi.mock('@/utils', () => ({ getTextWidthWithCanvas: (text: string) => text.length * 8 }))

it.each(['input', 'textarea'] as const)('edits a named metadata %s', async (inputType) => {
  const user = userEvent.setup()
  const onUpdate = vi.fn()
  render(
    <FieldInfo label="Title" value="Draft" showEdit inputType={inputType} onUpdate={onUpdate} />,
  )
  await user.type(screen.getByRole('textbox', { name: 'Title' }), '!')
  expect(onUpdate).toHaveBeenLastCalledWith('Draft!')
})

it('returns the selected language value rather than its display name', async () => {
  const user = userEvent.setup()
  const onUpdate = vi.fn()
  render(
    <FieldInfo
      label="Language"
      value="en"
      showEdit
      inputType="select"
      selectOptions={[
        { value: 'en', name: 'English' },
        { value: 'zh', name: 'Chinese' },
      ]}
      onUpdate={onUpdate}
    />,
  )
  await user.click(screen.getByRole('combobox', { name: 'Language' }))
  await user.click(await screen.findByRole('option', { name: 'Chinese' }))
  expect(onUpdate).toHaveBeenCalledWith('zh')
})
