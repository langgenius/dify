import { render, screen } from '@testing-library/react'
import MixedVariableTextInput from './index'

describe('MixedVariableTextInput', () => {
  it('should render placeholder guidance and data type badge', () => {
    render(<MixedVariableTextInput />)

    expect(screen.getByText('Type or press')).toBeInTheDocument()
    expect(screen.getByText('insert variable')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
  })

  it('should keep placeholder visible when editor is not editable', () => {
    render(<MixedVariableTextInput editable={false} />)
    expect(screen.getByText('insert variable')).toBeInTheDocument()
  })
})
