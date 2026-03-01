import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TagLabel from './tag-label'

describe('TagLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render edit icon label and trigger click handler when type is edit', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()

    const { container } = render(
      <TagLabel type="edit" onClick={onClick}>
        Edit
      </TagLabel>,
    )

    await user.click(screen.getByText('Edit'))

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('should render variable icon label when type is variable', () => {
    const { container } = render(
      <TagLabel type="variable">
        Variable
      </TagLabel>,
    )

    expect(screen.getByText('Variable')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
