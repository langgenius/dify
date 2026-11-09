import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ConfigurationsSection from '../configurations-section'

it('edits connection and SSE timeouts independently and accepts zero', async () => {
  const user = userEvent.setup()
  const onTimeoutChange = vi.fn()
  const onSseReadTimeoutChange = vi.fn()
  const Harness = () => {
    const [timeout, setTimeout] = useState(30)
    const [sseReadTimeout, setSseReadTimeout] = useState(300)
    return (
      <ConfigurationsSection
        timeout={timeout}
        sseReadTimeout={sseReadTimeout}
        onTimeoutChange={(value) => {
          setTimeout(value)
          onTimeoutChange(value)
        }}
        onSseReadTimeoutChange={(value) => {
          setSseReadTimeout(value)
          onSseReadTimeoutChange(value)
        }}
      />
    )
  }
  render(<Harness />)
  const timeout = screen.getByRole('textbox', { name: 'tools.mcp.modal.timeout' })
  const sse = screen.getByRole('textbox', { name: 'tools.mcp.modal.sseReadTimeout' })
  expect(timeout).toHaveValue('30')
  expect(sse).toHaveValue('300')
  await user.clear(timeout)
  await user.type(timeout, '45')
  await user.tab()
  expect(onTimeoutChange).toHaveBeenLastCalledWith(45)
  expect(sse).toHaveValue('300')
  await user.clear(sse)
  await user.type(sse, '0')
  await user.tab()
  expect(onSseReadTimeoutChange).toHaveBeenLastCalledWith(0)
  expect(timeout).toHaveValue('45')
})
