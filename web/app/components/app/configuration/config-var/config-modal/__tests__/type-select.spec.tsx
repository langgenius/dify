import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import TypeSelector from '../type-select'

const items = [
  { value: InputVarType.textInput, name: 'Text input' },
  { value: InputVarType.number, name: 'Number input' },
]

describe('ConfigModal TypeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers closed-state rendering and current selection display.
  describe('Rendering', () => {
    it('should render the current selected item label', () => {
      render(
        <TypeSelector
          value={InputVarType.textInput}
          items={items}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('Text input')).toBeInTheDocument()
      expect(screen.queryByText('Number input')).not.toBeInTheDocument()
    })
  })

  // Covers dropdown interactions and readonly behavior.
  describe('User interactions', () => {
    it('should call onSelect and close the list when choosing another item', () => {
      const onSelect = vi.fn()
      render(
        <TypeSelector
          value={InputVarType.textInput}
          items={items}
          onSelect={onSelect}
        />,
      )

      fireEvent.click(screen.getByText('Text input'))
      fireEvent.click(screen.getByText('Number input'))

      expect(onSelect).toHaveBeenCalledWith(items[1])
      expect(screen.queryByText('Number input')).not.toBeInTheDocument()
    })

    it('should keep the list closed when readonly is true', () => {
      render(
        <TypeSelector
          readonly
          value={InputVarType.textInput}
          items={items}
          onSelect={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByText('Text input'))

      expect(screen.queryByText('Number input')).not.toBeInTheDocument()
    })
  })
})
