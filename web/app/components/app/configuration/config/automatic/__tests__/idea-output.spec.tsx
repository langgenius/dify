import { fireEvent, render, screen } from '@testing-library/react'
import IdeaOutput from '../idea-output'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('IdeaOutput', () => {
  it('should toggle the fold state and propagate textarea changes when expanded', () => {
    const onChange = vi.fn()
    render(<IdeaOutput value="Initial idea" onChange={onChange} />)

    expect(screen.queryByPlaceholderText('generate.idealOutputPlaceholder')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('generate.idealOutput'))

    const textarea = screen.getByPlaceholderText('generate.idealOutputPlaceholder')
    fireEvent.change(textarea, { target: { value: 'Updated idea' } })

    expect(onChange).toHaveBeenCalledWith('Updated idea')

    fireEvent.click(screen.getByText('generate.idealOutput'))

    expect(screen.queryByPlaceholderText('generate.idealOutputPlaceholder')).not.toBeInTheDocument()
  })
})
