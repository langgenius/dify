import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SearchInput from './index'

describe('SearchInput', () => {
  it('should render with placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)

    expect(screen.getByPlaceholderText('common.dataSource.notion.selector.searchPages')).toBeInTheDocument()
    expect(screen.getByTestId('notion-search-input-container')).toBeInTheDocument()
  })

  it('should call onChange when typing', async () => {
    const handleChange = vi.fn()
    const user = userEvent.setup()
    render(<SearchInput value="" onChange={handleChange} />)

    const input = screen.getByTestId('notion-search-input')
    await user.type(input, 'test query')

    expect(handleChange).toHaveBeenCalled()
  })

  it('should show clear button when value is not empty', () => {
    render(<SearchInput value="some value" onChange={vi.fn()} />)

    expect(screen.getByTestId('notion-search-input-clear')).toBeInTheDocument()
  })

  it('should call onChange with empty string when clear button is clicked', async () => {
    const handleChange = vi.fn()
    const user = userEvent.setup()
    render(<SearchInput value="some value" onChange={handleChange} />)

    const clearBtn = screen.getByTestId('notion-search-input-clear')
    await user.click(clearBtn)

    expect(handleChange).toHaveBeenCalledWith('')
  })

  it('should not show clear button when value is empty', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)

    expect(screen.queryByTestId('notion-search-input-clear')).not.toBeInTheDocument()
  })
})
