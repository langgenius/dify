import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VersionSelector from '../version-selector'

describe('VersionSelector', () => {
  it('should not open the selector when only one version exists', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<VersionSelector versionLen={1} value={0} onChange={onChange} />)

    await user.click(screen.getByText(/(?:^|\.)generate\.version 1 · (?:.*\.)?generate\.latest$/))

    expect(screen.queryByText(/(?:^|\.)generate\.versions(?=$|:)/)).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should open the selector and switch versions when multiple versions exist', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<VersionSelector versionLen={3} value={2} onChange={onChange} />)

    await user.click(screen.getByText(/(?:^|\.)generate\.version 3 · (?:.*\.)?generate\.latest$/))

    expect(screen.getByText(/(?:^|\.)generate\.versions(?=$|:)/)).toBeInTheDocument()
    expect(screen.getByText(/(?:^|\.)generate\.version 1$/)).toBeInTheDocument()

    await user.click(screen.getByText(/(?:^|\.)generate\.version 1$/))

    expect(onChange).toHaveBeenCalledWith(0)
    await waitFor(() => {
      expect(screen.queryByText(/(?:^|\.)generate\.versions(?=$|:)/)).not.toBeInTheDocument()
    })
  })
})
