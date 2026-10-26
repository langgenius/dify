import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VariableMenuItem } from '../variable-option'

describe('VariableMenuItem', () => {
  const defaultProps = {
    title: 'Variable Name',
    isSelected: false,
    queryString: null,
    onClick: vi.fn(),
    onMouseEnter: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the title correctly', () => {
      render(<VariableMenuItem {...defaultProps} />)
      expect(screen.getByRole('option', { name: 'Variable Name' })).toHaveTextContent(
        'Variable Name',
      )
      expect(screen.getByTitle('Variable Name')).toBeInTheDocument()
    })

    it('should render the icon when provided', () => {
      render(<VariableMenuItem {...defaultProps} icon={<span>icon</span>} />)
      expect(screen.getByText('icon')).toBeInTheDocument()
    })

    it('should render the extra element when provided', () => {
      render(<VariableMenuItem {...defaultProps} extraElement={<span>extra</span>} />)
      expect(screen.getByText('extra')).toBeInTheDocument()
    })
  })

  describe('Highlighting Logic (queryString)', () => {
    it.each([null, '', 'missing'])('keeps the full label when the query is "%s"', (queryString) => {
      render(<VariableMenuItem {...defaultProps} queryString={queryString} />)
      expect(screen.getByRole('option', { name: 'Variable Name' })).toHaveTextContent(
        'Variable Name',
      )
      expect(screen.getByTitle('Variable Name')).toHaveTextContent('Variable Name')
    })

    it('should highlight matching text case-insensitively', () => {
      render(<VariableMenuItem {...defaultProps} title="User Name" queryString="user" />)
      expect(screen.getByText('User')).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'User Name' })).toHaveTextContent('User Name')
    })

    it.each(['System Variable', 'İstanbul System Variable'])(
      'highlights a partial match in "%s" without losing its full label',
      (title) => {
        render(<VariableMenuItem {...defaultProps} title={title} queryString="TEM" />)
        expect(screen.getByText('tem')).toBeInTheDocument()
        expect(screen.getByRole('option', { name: title })).toHaveTextContent(title)
        expect(screen.getByTitle(title)).toHaveTextContent(title)
      },
    )

    it.each(['[', '(', '\\', '.*'])(
      'highlights "%s" as literal text without changing the label',
      (queryString) => {
        const title = `Before ${queryString} after`
        render(<VariableMenuItem {...defaultProps} title={title} queryString={queryString} />)

        expect(screen.getByRole('option', { name: title })).toHaveTextContent(title)
        expect(screen.getByText(queryString)).toBeInTheDocument()
      },
    )
  })

  describe('Events', () => {
    it('should trigger onClick when clicked', async () => {
      const user = userEvent.setup()
      render(<VariableMenuItem {...defaultProps} />)
      await user.click(screen.getByRole('option', { name: 'Variable Name' }))
      expect(defaultProps.onClick).toHaveBeenCalledTimes(1)
    })

    it('should trigger onMouseEnter when mouse enters', async () => {
      const user = userEvent.setup()
      render(<VariableMenuItem {...defaultProps} />)
      await user.hover(screen.getByRole('option', { name: 'Variable Name' }))
      expect(defaultProps.onMouseEnter).toHaveBeenCalledTimes(1)
    })

    it('should prevent default and stop propagation onMouseDown', () => {
      const onParentMouseDown = vi.fn()
      render(
        <div role="presentation" onMouseDown={onParentMouseDown}>
          <VariableMenuItem {...defaultProps} />
        </div>,
      )
      const target = screen.getByRole('option', { name: 'Variable Name' })
      const event = createEvent.mouseDown(target)
      fireEvent(target, event)

      expect(event.defaultPrevented).toBe(true)
      expect(onParentMouseDown).not.toHaveBeenCalled()
    })
  })

  describe('Ref handling', () => {
    it('should call setRefElement with the element', () => {
      const setRefElement = vi.fn()
      render(<VariableMenuItem {...defaultProps} setRefElement={setRefElement} />)

      expect(setRefElement).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
    })
  })
})
