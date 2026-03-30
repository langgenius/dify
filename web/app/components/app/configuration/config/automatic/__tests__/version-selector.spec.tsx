import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VersionSelector from '../version-selector'

describe('VersionSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const clickTrigger = () => {
    fireEvent.click(screen.getByText('appDebug.generate.version 2 · appDebug.generate.latest'))
  }

  it('should render the current version label and keep single-version selectors closed', () => {
    const onChange = vi.fn()
    render(<VersionSelector onChange={onChange} value={0} versionLen={1} />)

    fireEvent.click(screen.getByText('appDebug.generate.version 1 · appDebug.generate.latest'))

    expect(screen.queryByText('appDebug.generate.versions')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('should open the selector and emit the chosen version', async () => {
    const onChange = vi.fn()
    render(<VersionSelector onChange={onChange} value={1} versionLen={2} />)

    clickTrigger()
    fireEvent.click(await screen.findByTitle('appDebug.generate.version 1'))

    expect(onChange).toHaveBeenCalledWith(0)
    await waitFor(() => {
      expect(screen.queryByText('appDebug.generate.versions')).not.toBeInTheDocument()
    })
  })
})
