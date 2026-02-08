import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { importSchemaFromURL } from '@/service/tools'
import Toast from '../../base/toast'
import examples from './examples'
import GetSchema from './get-schema'

vi.mock('@/service/tools', () => ({
  importSchemaFromURL: vi.fn(),
}))
const importSchemaFromURLMock = vi.mocked(importSchemaFromURL)

describe('GetSchema', () => {
  const notifySpy = vi.spyOn(Toast, 'notify')
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    notifySpy.mockClear()
    importSchemaFromURLMock.mockReset()
    render(<GetSchema onChange={mockOnChange} />)
  })

  it('shows an error when the URL is not http', () => {
    fireEvent.click(screen.getByText('tools.createTool.importFromUrl'))
    const input = screen.getByPlaceholderText('tools.createTool.importFromUrlPlaceHolder')

    fireEvent.change(input, { target: { value: 'ftp://invalid' } })
    fireEvent.click(screen.getByText('common.operation.ok'))

    expect(notifySpy).toHaveBeenCalledWith({
      type: 'error',
      message: 'tools.createTool.urlError',
    })
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
