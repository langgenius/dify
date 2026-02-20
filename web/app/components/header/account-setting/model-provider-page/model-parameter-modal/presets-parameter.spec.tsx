import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import PresetsParameter from './presets-parameter'

vi.mock('@/app/components/base/dropdown', () => ({
  default: ({ renderTrigger, items, onSelect }: { renderTrigger: (open: boolean) => React.ReactNode, items: { value: number, text: string }[], onSelect: (item: { value: number }) => void }) => (
    <div>
      {renderTrigger(false)}
      {items.map(item => (
        <button key={item.value} onClick={() => onSelect(item)}>
          {item.text}
        </button>
      ))}
    </div>
  ),
}))

describe('PresetsParameter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render presets and handle selection', () => {
    const onSelect = vi.fn()
    render(<PresetsParameter onSelect={onSelect} />)

    expect(screen.getByText('common.modelProvider.loadPresets')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.model.tone.Creative'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })
})
