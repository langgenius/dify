import type { Mock } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import RunBatch from './index'

vi.mock('@/hooks/use-breakpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-breakpoints')>()
  return {
    default: vi.fn(),
    MediaType: actual.MediaType,
  }
})

let latestOnParsed: ((data: string[][]) => void) | undefined
let receivedCSVDownloadProps: Record<string, unknown> | undefined

vi.mock('./csv-reader', () => ({
  default: (props: { onParsed: (data: string[][]) => void }) => {
    latestOnParsed = props.onParsed
    return <div data-testid="csv-reader" />
  },
}))

vi.mock('./csv-download', () => ({
  default: (props: { vars: { name: string }[] }) => {
    receivedCSVDownloadProps = props
    return <div data-testid="csv-download" />
  },
}))

const mockUseBreakpoints = useBreakpoints as Mock

describe('RunBatch', () => {
  const vars = [{ name: 'prompt' }]

  beforeEach(() => {
    mockUseBreakpoints.mockReturnValue(MediaType.pc)
    latestOnParsed = undefined
    receivedCSVDownloadProps = undefined
    vi.clearAllMocks()
  })

  it('should enable run button after CSV parsed and send data', async () => {
    const onSend = vi.fn()
    render(
      <RunBatch
        vars={vars}
        onSend={onSend}
        isAllFinished
      />,
    )

    expect(receivedCSVDownloadProps?.vars).toEqual(vars)
    await act(async () => {
      latestOnParsed?.([['row1']])
    })

    const runButton = screen.getByRole('button', { name: 'share.generation.run' })
    await waitFor(() => {
      expect(runButton).not.toBeDisabled()
    })

    fireEvent.click(runButton)
    expect(onSend).toHaveBeenCalledWith([['row1']])
  })

  it('should keep button disabled and show spinner when results still running on mobile', async () => {
    mockUseBreakpoints.mockReturnValue(MediaType.mobile)
    const onSend = vi.fn()
    const { container } = render(
      <RunBatch
        vars={vars}
        onSend={onSend}
        isAllFinished={false}
      />,
    )

    await act(async () => {
      latestOnParsed?.([['row']])
    })

    const runButton = screen.getByRole('button', { name: 'share.generation.run' })
    await waitFor(() => {
      expect(runButton).toBeDisabled()
    })
    expect(runButton).toHaveClass('grow')
    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('animate-spin')
    expect(onSend).not.toHaveBeenCalled()
  })
})
