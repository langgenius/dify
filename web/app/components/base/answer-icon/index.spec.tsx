import { render, screen } from '@testing-library/react'
import AnswerIcon from '.'

describe('AnswerIcon', () => {
  it('renders default emoji when no icon or image is provided', () => {
    const { container } = render(<AnswerIcon />)
    const emojiElement = container.querySelector('em-emoji')
    expect(emojiElement).toBeInTheDocument()
    expect(emojiElement).toHaveAttribute('id', '🤖')
  })

  it('renders with custom emoji when icon is provided', () => {
    const { container } = render(<AnswerIcon icon="smile" />)
    const emojiElement = container.querySelector('em-emoji')
    expect(emojiElement).toBeInTheDocument()
    expect(emojiElement).toHaveAttribute('id', 'smile')
  })
  it('renders image when iconType is image and imageUrl is provided', () => {
    render(<AnswerIcon iconType="image" imageUrl="test-image.jpg" />)
    const imgElement = screen.getByAltText('answer icon')
    expect(imgElement).toBeInTheDocument()
    expect(imgElement).toHaveAttribute('src', 'test-image.jpg')
  })

  it('applies custom background color', () => {
    const { container } = render(<AnswerIcon background="#FF5500" />)
    expect(container.firstChild).toHaveStyle('background: #FF5500')
  })

  it('uses default background color when no background is provided for non-image icons', () => {
    const { container } = render(<AnswerIcon />)
    expect(container.firstChild).toHaveStyle('background: #D5F5F6')
  })
})
