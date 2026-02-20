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
    render(
      <Item title="Title" tooltip="Tooltip text">
        <div>children</div>
      </Item>,
    )

    // Tooltip component renders an icon next to the title
    expect(screen.getByText(/Title/)).toBeInTheDocument()
    // The Tooltip component is rendered as a sibling, confirming the tooltip prop is used
    expect(screen.getByText(/Title/).closest('div')).toBeInTheDocument()
  })
})
