import { fireEvent, render, screen } from '@testing-library/react'
import InputFieldButton from '../input-field-button'

const {
  mockSetShowInputFieldPanel,
  mockSetShowEnvPanel,
} = vi.hoisted(() => ({
  mockSetShowInputFieldPanel: vi.fn(),
  mockSetShowEnvPanel: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    setShowInputFieldPanel: typeof mockSetShowInputFieldPanel
    setShowEnvPanel: typeof mockSetShowEnvPanel
  }) => unknown) => selector({
    setShowInputFieldPanel: mockSetShowInputFieldPanel,
    setShowEnvPanel: mockSetShowEnvPanel,
  }),
}))

describe('InputFieldButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should open the input field panel and close the env panel', () => {
    render(<InputFieldButton />)

    fireEvent.click(screen.getByRole('button', { name: 'datasetPipeline.inputField' }))

    expect(mockSetShowInputFieldPanel).toHaveBeenCalledWith(true)
    expect(mockSetShowEnvPanel).toHaveBeenCalledWith(false)
  })
})
