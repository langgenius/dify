import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import EditItem, { EditItemType } from './index'

describe('AddAnnotationModal/EditItem', () => {
  test('should render query inputs with user avatar and placeholder strings', () => {
    render(
      <EditItem
        type={EditItemType.Query}
        content="Why?"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('appAnnotation.addModal.queryName')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('appAnnotation.addModal.queryPlaceholder')).toBeInTheDocument()
    expect(screen.getByText('Why?')).toBeInTheDocument()
  })

  test('should render answer name and placeholder text', () => {
    render(
      <EditItem
        type={EditItemType.Answer}
        content="Existing answer"
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('appAnnotation.addModal.answerName')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Existing answer')).toBeInTheDocument()
  })

  test('should propagate changes when answer content updates', () => {
    const handleChange = vi.fn()
    render(
      <EditItem
        type={EditItemType.Answer}
        content=""
        onChange={handleChange}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('appAnnotation.addModal.answerPlaceholder'), { target: { value: 'Because' } })
    expect(handleChange).toHaveBeenCalledWith('Because')
  })
})
