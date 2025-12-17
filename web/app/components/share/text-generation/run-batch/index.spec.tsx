import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RunBatch from './index'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'

jest.mock('@/hooks/use-breakpoints', () => {
  const actual = jest.requireActual('@/hooks/use-breakpoints')
  return {
    __esModule: true,
    default: jest.fn(),
    MediaType: actual.MediaType,
  }
})

let latestOnParsed: ((data: string[][]) => void) | undefined
let receivedCSVDownloadProps: Record<string, unknown> | undefined

jest.mock('./csv-reader', () => (props: { onParsed: (data: string[][]) => void }) => {
  latestOnParsed = props.onParsed
  return <div data-testid="csv-reader" />
})

jest.mock('./csv-download', () => (props: { vars: { name: string }[] }) => {
  receivedCSVDownloadProps = props
  return <div data-testid="csv-download" />
})

const mockUseBreakpoints = useBreakpoints as jest.Mock

describe('RunBatch', () => {
  const vars = [{ name: 'prompt' }]

  beforeEach(() => {
    mockUseBreakpoints.mockReturnValue(MediaType.pc)
    latestOnParsed = undefined
    receivedCSVDownloadProps = undefined
    jest.clearAllMocks()
  })

  test('should enable run button after CSV parsed and send data', async () => {
    const onSend = jest.fn()
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

  test('should keep button disabled and show spinner when results still running on mobile', async () => {
    mockUseBreakpoints.mockReturnValue(MediaType.mobile)
    const onSend = jest.fn()
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
