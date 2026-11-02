import { render, screen } from '@testing-library/react'
import HeadersSection from '../headers-section'

it.each([
  { isCreate: true, keys: ['Authorization'], masked: false },
  { isCreate: false, keys: ['Authorization'], masked: true },
  { isCreate: false, keys: ['', '   '], masked: false },
  { isCreate: false, keys: ['', 'Authorization'], masked: true },
])(
  'shows saved-header guidance only for existing nonblank keys: $keys, create=$isCreate',
  ({ isCreate, keys, masked }) => {
    render(
      <HeadersSection
        isCreate={isCreate}
        onHeadersChange={vi.fn()}
        headers={keys.map((key, index) => ({ id: String(index), key, value: 'value' }))}
      />,
    )
    const tip = screen.queryByText('tools.mcp.modal.maskedHeadersTip')
    if (masked) expect(tip).toBeInTheDocument()
    else expect(tip).not.toBeInTheDocument()
  },
)
