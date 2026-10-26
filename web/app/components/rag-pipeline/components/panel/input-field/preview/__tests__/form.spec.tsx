import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PipelineInputVarType } from '@/models/pipeline'
import { createPipelineVariable } from '@/test/pipeline-variables'
import Form from '../form'

it('builds editable fields with defaults from the pipeline variables', async () => {
  const user = userEvent.setup()
  render(
    <Form
      variables={[
        createPipelineVariable({ default_value: 'docs' }),
        createPipelineVariable({
          variable: 'notes',
          label: 'Notes',
          type: PipelineInputVarType.paragraph,
          default_value: 'Additional context',
        }),
      ]}
    />,
  )
  const source = screen.getByRole('textbox', { name: /Source/ })
  expect(source).toHaveValue('docs')
  expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveValue('Additional context')
  await user.clear(source)
  await user.type(source, 'new source')
  expect(source).toHaveValue('new source')
  expect(screen.getByRole('textbox', { name: /Notes/ })).toHaveValue('Additional context')
})
