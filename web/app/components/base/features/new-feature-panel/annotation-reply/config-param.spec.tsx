import { render, screen } from '@testing-library/react'
import { Item } from './config-param'

describe('ConfigParam Item', () => {
  it('should render title text', () => {
    render(
      <Item title="Score Threshold" tooltip="Tooltip text">
        <div>children</div>
      </Item>,
    )

    expect(screen.getByText('Score Threshold')).toBeInTheDocument()
  })

  it('should render children', () => {
    render(
      <Item title="Title" tooltip="Tooltip">
        <div data-testid="child-content">Child</div>
      </Item>,
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should render tooltip icon', () => {
    const { container } = render(
      <Item title="Title" tooltip="Tooltip text">
        <div>children</div>
      </Item>,
    )

    // Tooltip component renders an SVG icon
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
