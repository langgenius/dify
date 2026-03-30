import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SelectVarType from '../select-var-type'

describe('SelectVarType', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const clickAddTrigger = () => {
    const label = screen.getByText('common.operation.add')
    const trigger = label.closest('div.cursor-pointer')
    expect(trigger).not.toBeNull()
    fireEvent.click(trigger!)
  }

  it('should open the type list from the add trigger', async () => {
    render(<SelectVarType onChange={vi.fn()} />)

    clickAddTrigger()

    expect(await screen.findByText('appDebug.variableConfig.string')).toBeInTheDocument()
    expect(screen.getByText('appDebug.variableConfig.apiBasedVar')).toBeInTheDocument()
  })

  it('should emit the selected type and close the list', async () => {
    const onChange = vi.fn()
    render(<SelectVarType onChange={onChange} />)

    clickAddTrigger()
    fireEvent.click(await screen.findByText('appDebug.variableConfig.apiBasedVar'))

    expect(onChange).toHaveBeenCalledWith('api')
    await waitFor(() => {
      expect(screen.queryByText('appDebug.variableConfig.string')).not.toBeInTheDocument()
    })
  })
})
