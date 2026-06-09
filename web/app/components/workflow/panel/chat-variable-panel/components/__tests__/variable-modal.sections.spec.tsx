import { fireEvent, render, screen } from '@testing-library/react'
import { ChatVarType } from '../../type'
import {
  DescriptionSection,
  NameSection,
  TypeSection,
  ValueSection,
} from '../variable-modal.sections'

describe('variable-modal sections', () => {
  it('renders name and description sections and forwards input changes', () => {
    const onNameBlur = vi.fn()
    const onNameChange = vi.fn()
    const onDescriptionChange = vi.fn()

    render(
      <>
        <NameSection
          name="query"
          onBlur={onNameBlur}
          onChange={onNameChange}
          placeholder="name-placeholder"
          title="Name"
        />
        <DescriptionSection
          description="original description"
          onChange={onDescriptionChange}
          placeholder="description-placeholder"
          title="Description"
        />
      </>,
    )

    const nameInput = screen.getByDisplayValue('query')
    const descriptionInput = screen.getByDisplayValue('original description')

    fireEvent.change(nameInput, { target: { value: 'updated-query' } })
    fireEvent.blur(nameInput, { target: { value: 'updated-query' } })
    fireEvent.change(descriptionInput, { target: { value: 'updated-description' } })

    expect(onNameChange).toHaveBeenCalled()
    expect(onNameBlur).toHaveBeenCalledWith('updated-query')
    expect(onDescriptionChange).toHaveBeenCalledWith('updated-description')
  })

  it('renders type and value sections and forwards toggle and value changes', async () => {
    const onSelect = vi.fn()
    const onArrayChange = vi.fn()
    const onEditorChange = vi.fn()
    const onObjectChange = vi.fn()
    const onValueChange = vi.fn()

    render(
      <>
        <TypeSection
          list={[ChatVarType.String, ChatVarType.Boolean]}
          onSelect={onSelect}
          title="Type"
          type={ChatVarType.String}
        />
        <ValueSection
          editInJSON={false}
          editorMinHeight="240px"
          objectValue={[]}
          onArrayBoolChange={vi.fn()}
          onArrayChange={onArrayChange}
          onEditorChange={onEditorChange}
          onEditorValueChange={vi.fn()}
          onObjectChange={onObjectChange}
          onValueChange={onValueChange}
          placeholder="placeholder"
          t={(key: string) => key}
          toggleLabelKey="chatVariable.modal.editInJSON"
          type={ChatVarType.String}
          value="draft"
        />
      </>,
    )

    expect(screen.getByText('Type')).toBeInTheDocument()
    expect(screen.getByDisplayValue('draft')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('draft'), { target: { value: 'published' } })
    fireEvent.click(screen.getByText('chatVariable.modal.editInJSON'))

    expect(onArrayChange).toHaveBeenCalledWith(['published'])
    expect(onEditorChange).toHaveBeenCalledWith(true)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onObjectChange).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
