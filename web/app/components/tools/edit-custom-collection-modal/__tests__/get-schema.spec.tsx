import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { importSchemaFromURL } from '@/service/tools'
import examples from '../examples'
import GetSchema from '../get-schema'

vi.mock('@/service/tools', () => ({
  importSchemaFromURL: vi.fn(),
}))
const mockToastError = vi.hoisted(() => vi.fn())
vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))
const importSchemaFromURLMock = vi.mocked(importSchemaFromURL)

describe('GetSchema', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    importSchemaFromURLMock.mockReset()
    render(<GetSchema onChange={mockOnChange} />)
  })

  it('shows an error when the URL is not http', () => {
    fireEvent.click(screen.getByText('tools.createTool.importFromUrl'))
    const input = screen.getByPlaceholderText('tools.createTool.importFromUrlPlaceHolder')

    fireEvent.change(input, { target: { value: 'ftp://invalid' } })
    fireEvent.click(screen.getByText('common.operation.ok'))

    expect(mockToastError).toHaveBeenCalledWith('tools.createTool.urlError')
  })

  it('imports schema from url when valid', async () => {
    fireEvent.click(screen.getByText('tools.createTool.importFromUrl'))
    const input = screen.getByPlaceholderText('tools.createTool.importFromUrlPlaceHolder')
    fireEvent.change(input, { target: { value: 'https://example.com' } })
    importSchemaFromURLMock.mockResolvedValueOnce({ schema: 'result-schema' })

    fireEvent.click(screen.getByText('common.operation.ok'))

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith('result-schema')
    })
  })

  it('selects example schema when example option clicked', () => {
    fireEvent.click(screen.getByText('tools.createTool.examples'))
    fireEvent.click(screen.getByText(`tools.createTool.exampleOptions.${examples[0].key}`))

    expect(mockOnChange).toHaveBeenCalledWith(examples[0].content)
  })
})
