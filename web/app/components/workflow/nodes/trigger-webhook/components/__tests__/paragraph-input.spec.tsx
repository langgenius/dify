import { render, screen } from '@testing-library/react'
import ParagraphInput from '../paragraph-input'

it('updates line numbers when multiline content changes, keeping three lines for short content', () => {
  const onChange = vi.fn()
  const { rerender } = render(
    <ParagraphInput value={'one\ntwo\nthree\nfour'} onChange={onChange} />,
  )
  expect(screen.getByText('01')).toBeInTheDocument()
  expect(screen.getByText('04')).toBeInTheDocument()

  rerender(<ParagraphInput value="one" onChange={onChange} />)
  expect(screen.getByText('03')).toBeInTheDocument()
  expect(screen.queryByText('04')).not.toBeInTheDocument()
})
