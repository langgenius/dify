import type { VarInInspect } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { VarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'
import {
  BoolArraySection,
  ErrorMessages,
  JsonEditorSection,
  TextEditorSection,
} from '../value-content-sections'

// Rich JSON editing is independently tested; retain the readonly contract at this boundary.
vi.mock(
  '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor',
  () => ({
    default: ({
      schema,
      readonly,
      onUpdate,
    }: {
      schema: string
      readonly?: boolean
      onUpdate: (value: string) => void
    }) => (
      <textarea
        aria-label="JSON"
        value={schema}
        readOnly={readonly}
        onChange={(event) => onUpdate(event.target.value)}
      />
    ),
  }),
)
const createVar = (value_type: VarType): VarInInspect => ({
  id: 'var-1',
  name: 'value',
  type: VarInInspectType.node,
  value_type,
  value: '',
  description: '',
  selector: ['node-1', 'value'],
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: { size_bytes: 0, download_url: '' },
})
it.each([VarType.string, VarType.number])(
  'edits a %s value and blocks edits when the field becomes read-only',
  async (type) => {
    function Editor({ readonly }: { readonly: boolean }) {
      const [value, setValue] = useState('12')
      return (
        <TextEditorSection
          currentVar={createVar(type)}
          value={value}
          textEditorDisabled={readonly}
          isTruncated={false}
          onTextChange={setValue}
        />
      )
    }
    const user = userEvent.setup()
    const { rerender } = render(<Editor readonly={false} />)
    const input = screen.getByRole('textbox')
    await user.clear(input)
    await user.type(input, '24')
    expect(input).toHaveValue('24')
    rerender(<Editor readonly />)
    await user.type(screen.getByRole('textbox'), '5')
    expect(screen.getByRole('textbox')).toHaveValue('24')
  },
)
it('edits only the selected boolean array entry and retains the previous edit', async () => {
  function Editor() {
    const [values, setValues] = useState([true, false])
    return (
      <>
        <BoolArraySection values={values} onChange={setValues} />
        <output aria-label="Values">{JSON.stringify(values)}</output>
      </>
    )
  }
  const user = userEvent.setup()
  render(<Editor />)
  await user.click(screen.getAllByRole('button', { name: 'True' })[1]!)
  expect(screen.getByRole('status')).toHaveTextContent('[true,true]')
  await user.click(screen.getAllByRole('button', { name: 'False' })[0]!)
  expect(screen.getByRole('status')).toHaveTextContent('[false,true]')
})
it('keeps truncated JSON read-only and displays parsing and validation errors', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <>
      <JsonEditorSection
        hasChunks={false}
        valueType={VarType.object}
        json='{"foo":1}'
        readonly={false}
        isTruncated
        onChange={onChange}
      />
      <ErrorMessages parseError={new Error('Broken JSON')} validationError="Too deep" />
    </>,
  )
  await user.type(screen.getByRole('textbox', { name: 'JSON' }), 'x')
  expect(screen.getByRole('textbox', { name: 'JSON' })).toHaveValue('{"foo":1}')
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByText('Broken JSON')).toBeVisible()
  expect(screen.getByText('Too deep')).toBeVisible()
})
