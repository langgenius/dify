import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import HeadersSection from '../headers-section'

describe('HeadersSection', () => {
  it.each([
    { isCreate: true, key: 'Authorization', masked: false },
    { isCreate: false, key: '', masked: false },
    { isCreate: false, key: '   ', masked: false },
    { isCreate: false, key: 'Authorization', masked: true },
  ])(
    'sets masked guidance to $masked for create=$isCreate and key="$key"',
    ({ isCreate, key, masked }) => {
      render(
        <HeadersSection
          headers={[{ id: 'header-1', key, value: '***' }]}
          onHeadersChange={vi.fn()}
          isCreate={isCreate}
        />,
      )

      const maskedTip = screen.queryByText('tools.mcp.modal.maskedHeadersTip')
      if (masked) expect(maskedTip).toBeInTheDocument()
      else expect(maskedTip).not.toBeInTheDocument()
    },
  )
})
