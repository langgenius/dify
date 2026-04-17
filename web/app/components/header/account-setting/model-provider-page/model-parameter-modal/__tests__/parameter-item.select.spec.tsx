import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import ParameterItem from '../parameter-item'

vi.mock('../../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/app/components/base/ui/select', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/ui/select')>()

  return {
    ...actual,
    Select: ({ children, onValueChange }: { children: ReactNode, onValueChange: (value: string | undefined) => void }) => (
      <div>
        <button type="button" onClick={() => onValueChange('updated')}>select-updated</button>
        <button type="button" onClick={() => onValueChange(undefined)}>select-empty</button>
        {children}
      </div>
    ),
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => <div>SelectValue</div>,
    SelectItemText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    SelectItemIndicator: () => <span data-testid="select-item-indicator" />,
  }
})

describe('ParameterItem select mode', () => {
  it('should propagate both explicit and empty select values', () => {
    const onChange = vi.fn()

    render(
      <ParameterItem
        parameterRule={{
          name: 'format',
          label: { en_US: 'Format', zh_Hans: 'Format' },
          type: 'string',
          options: ['json', 'text'],
          required: false,
          help: { en_US: 'Help', zh_Hans: 'Help' },
        }}
        value="json"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'select-updated' }))
    fireEvent.click(screen.getByRole('button', { name: 'select-empty' }))

    expect(onChange).toHaveBeenNthCalledWith(1, 'updated')
    expect(onChange).toHaveBeenNthCalledWith(2, undefined)
  })
})
