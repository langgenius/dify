import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import FormattingChanged from './formatting-changed'

describe('FormattingChanged WarningMask', () => {
  it('should display translation text and both actions', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <FormattingChanged
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByText('appDebug.formattingChangedTitle')).toBeInTheDocument()
    expect(screen.getByText('appDebug.formattingChangedText')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /common\.operation\.refresh/ })).toBeInTheDocument()
  })

  it('should call callbacks when buttons are clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <FormattingChanged
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.refresh/ }))
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
