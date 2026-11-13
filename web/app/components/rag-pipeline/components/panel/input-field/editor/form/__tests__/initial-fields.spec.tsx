import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm } from '@/app/components/base/form'
import { PipelineInputVarType } from '@/models/pipeline'
import InitialFields from '../initial-fields'

const initialData: NonNullable<Parameters<typeof InitialFields>[0]['initialData']> = {
  type: PipelineInputVarType.textInput,
  variable: '',
  label: '',
  maxLength: 48,
  required: true,
}
const Fields = InitialFields({ initialData, supportFile: false })
const Harness = () => {
  const form = useAppForm({ defaultValues: initialData })
  return <Fields form={form} />
}

it('fills a missing display name on variable blur and preserves a custom display name', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const variable = screen.getByRole('textbox', { name: /appDebug.variableConfig.varName/ })
  const label = screen.getByRole('textbox', { name: /appDebug.variableConfig.displayName/ })
  await user.type(variable, 'source')
  await user.tab()
  expect(label).toHaveValue('source')
  await user.clear(label)
  await user.type(label, 'Custom source')
  await user.clear(variable)
  await user.type(variable, 'renamed')
  await user.tab()
  expect(label).toHaveValue('Custom source')
  await user.clear(label)
  await user.tab()
  expect(label).toHaveValue('renamed')
})
