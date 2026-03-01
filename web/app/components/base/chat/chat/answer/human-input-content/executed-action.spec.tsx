import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ExecutedAction from './executed-action'

describe('ExecutedAction', () => {
  it('should render the triggered action information', () => {
    const executedAction = {
      id: 'btn_1',
      title: 'Submit',
    }

    render(<ExecutedAction executedAction={executedAction} />)

    expect(screen.getByTestId('executed-action')).toBeInTheDocument()

    // Trans component mock from i18n-mock.ts renders a span with data-i18n-key
    const trans = screen.getByTestId('executed-action').querySelector('span')
    expect(trans).toHaveAttribute('data-i18n-key', 'nodes.humanInput.userActions.triggered')

    // Check for the trigger icon class
    expect(screen.getByTestId('executed-action').querySelector('.i-custom-vender-workflow-trigger-all')).toBeInTheDocument()
  })
})
