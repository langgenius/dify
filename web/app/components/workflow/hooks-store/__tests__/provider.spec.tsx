import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HooksStoreContextProvider } from '../provider'
import { useHooksStore } from '../store'

vi.mock('reactflow', () => ({
  useStore: (selector: (state: { d3Selection: null; d3Zoom: null }) => unknown) =>
    selector({ d3Selection: null, d3Zoom: null }),
}))

const ExportButton = () => {
  const isExporting = useHooksStore((state) => state.isExporting)
  const handleExportDSL = useHooksStore((state) => state.handleExportDSL)
  return (
    <button disabled={isExporting} onClick={() => handleExportDSL?.()}>
      Export
    </button>
  )
}

describe('hooks-store provider', () => {
  it('propagates export pending state and the latest handler independently of canvas initialization', async () => {
    const user = userEvent.setup()
    const firstExport = vi.fn().mockResolvedValue(true)
    const retryExport = vi.fn().mockResolvedValue(true)
    const { rerender } = render(
      <HooksStoreContextProvider handleExportDSL={firstExport} isExporting={false}>
        <ExportButton />
      </HooksStoreContextProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(firstExport).toHaveBeenCalledTimes(1)

    rerender(
      <HooksStoreContextProvider handleExportDSL={firstExport} isExporting>
        <ExportButton />
      </HooksStoreContextProvider>,
    )
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()

    rerender(
      <HooksStoreContextProvider handleExportDSL={retryExport} isExporting={false}>
        <ExportButton />
      </HooksStoreContextProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Export' }))
    expect(retryExport).toHaveBeenCalledTimes(1)
    expect(firstExport).toHaveBeenCalledTimes(1)
  })
})
