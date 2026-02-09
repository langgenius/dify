import { fireEvent, render, screen } from '@testing-library/react'
import TemplateSearch from './template-search'

describe('TemplateSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render search input with translated placeholder', () => {
      render(<TemplateSearch onChange={vi.fn()} />)

      expect(screen.getByPlaceholderText('workflow.skill.startTab.searchPlaceholder')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange once with the latest value when typing quickly', () => {
      const onChange = vi.fn()
      render(<TemplateSearch onChange={onChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'a' } })
      fireEvent.change(input, { target: { value: 'ab' } })
      fireEvent.change(input, { target: { value: 'abc' } })

      expect(input).toHaveValue('abc')
      expect(onChange).not.toHaveBeenCalled()

      vi.advanceTimersByTime(299)
      expect(onChange).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith('abc')
    })

    it('should call onChange with an empty string when the input is cleared', () => {
      const onChange = vi.fn()
      render(<TemplateSearch onChange={onChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'alpha' } })
      vi.advanceTimersByTime(300)
      fireEvent.change(input, { target: { value: '' } })
      vi.advanceTimersByTime(300)

      expect(onChange).toHaveBeenCalledTimes(2)
      expect(onChange).toHaveBeenNthCalledWith(1, 'alpha')
      expect(onChange).toHaveBeenNthCalledWith(2, '')
    })
  })
})
