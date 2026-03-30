import type { CodeDependency } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DependencyPicker from '../dependency-picker'

const dependencies: CodeDependency[] = [
  { name: 'numpy', version: '1.0.0' },
  { name: 'pandas', version: '2.0.0' },
]

describe('DependencyPicker', () => {
  it('should open the dependency list, filter by search text, and select a new dependency', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <DependencyPicker
        value={dependencies[0]!}
        available_dependencies={dependencies}
        onChange={onChange}
      />,
    )

    expect(screen.getByText('numpy')).toBeInTheDocument()

    await user.click(screen.getByText('numpy'))
    await user.type(screen.getByRole('textbox'), 'pan')

    expect(screen.getByRole('textbox')).toHaveValue('pan')
    expect(screen.getByText('pandas')).toBeInTheDocument()

    await user.click(screen.getByText('pandas'))

    expect(onChange).toHaveBeenCalledWith(dependencies[1])
    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })
})
