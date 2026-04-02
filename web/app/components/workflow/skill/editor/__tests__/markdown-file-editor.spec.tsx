import { act, render, screen } from '@testing-library/react'

import MarkdownFileEditor from '../markdown-file-editor'

const mocks = vi.hoisted(() => ({
  onChange: vi.fn(),
  onAutoFocus: vi.fn(),
  skillEditorProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../skill-editor', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.skillEditorProps.push(props)
    return (
      <div>
        <button type="button" onClick={() => (props.onChange as (value: string) => void)('updated')}>
          emit-change
        </button>
        <button type="button" onClick={() => (props.onChange as (value: string) => void)(String(props.value))}>
          emit-same-value
        </button>
        <div data-testid="skill-editor-props" />
      </div>
    )
  },
}))

describe('MarkdownFileEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.skillEditorProps.length = 0
  })

  it('should pass editable collaboration props and only emit changed values', () => {
    render(
      <MarkdownFileEditor
        instanceId="file-1"
        value="hello"
        onChange={mocks.onChange}
        autoFocus
        onAutoFocus={mocks.onAutoFocus}
        collaborationEnabled
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'emit-change' }).click()
    })

    expect(mocks.onChange).toHaveBeenCalledWith('updated')
    expect(mocks.skillEditorProps[0]).toMatchObject({
      instanceId: 'file-1',
      value: 'hello',
      editable: true,
      autoFocus: true,
      collaborationEnabled: true,
      showLineNumbers: true,
    })
  })

  it('should disable editing features and placeholder in read only mode', () => {
    render(
      <MarkdownFileEditor
        value="hello"
        onChange={mocks.onChange}
        autoFocus
        collaborationEnabled
        readOnly
      />,
    )

    expect(mocks.skillEditorProps[0]).toMatchObject({
      editable: false,
      autoFocus: false,
      collaborationEnabled: false,
      placeholder: undefined,
    })
  })

  it('should ignore editor updates that do not change the value', () => {
    render(
      <MarkdownFileEditor
        value="hello"
        onChange={mocks.onChange}
      />,
    )

    act(() => {
      screen.getByRole('button', { name: 'emit-same-value' }).click()
    })

    expect(mocks.onChange).not.toHaveBeenCalled()
  })
})
