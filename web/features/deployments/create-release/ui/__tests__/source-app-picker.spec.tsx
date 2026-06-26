import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SourceAppPicker } from '../source-app-picker'

function renderSourceAppPicker(disabled: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SourceAppPicker
        value={{ id: 'app-1', name: 'Workflow 1' }}
        onChange={() => undefined}
        ariaLabel="Source app"
        disabled={disabled}
      />
    </QueryClientProvider>,
  )
}

describe('SourceAppPicker', () => {
  it('should disable the switch control when disabled', () => {
    renderSourceAppPicker(true)

    expect(screen.getByText('Workflow 1')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Source app' })).toBeDisabled()
  })
})
