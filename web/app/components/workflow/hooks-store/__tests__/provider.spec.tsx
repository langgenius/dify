import type { AvailableNodesMetaData } from '../store'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockClassification } from '../../block-selector/types'
import { BlockEnum } from '../../types'
import { HooksStoreContextProvider } from '../provider'
import { useHooksStore } from '../store'

const canvas = vi.hoisted(() => ({
  d3Selection: null as object | null,
  d3Zoom: null as object | null,
}))

vi.mock('reactflow', () => ({
  useStore: (selector: (state: typeof canvas) => unknown) => selector(canvas),
}))

const createCatalog = (...types: BlockEnum[]): AvailableNodesMetaData => ({
  nodes: types.map((type) => ({
    metaData: {
      classification: BlockClassification.Default,
      sort: 0,
      type,
      title: type,
      author: 'Dify',
    },
    defaultValue: {},
    checkValid: () => ({ isValid: true }),
  })),
})

const AvailableNodes = () => {
  const catalog = useHooksStore((state) => state.availableNodesMetaData)
  return (
    <output aria-label="Available nodes">
      {catalog?.nodes.map((node) => node.metaData.type).join(', ')}
    </output>
  )
}

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
  beforeEach(() => {
    canvas.d3Selection = null
    canvas.d3Zoom = null
  })

  it.each(['before', 'after'] as const)(
    'propagates node catalog changes %s canvas initialization',
    (timing) => {
      if (timing === 'after') {
        canvas.d3Selection = {}
        canvas.d3Zoom = {}
      }
      const initialCatalog = createCatalog(BlockEnum.KnowledgeRetrieval)
      const enabledCatalog = createCatalog(
        BlockEnum.KnowledgeRetrieval,
        BlockEnum.KnowledgeRetrievalV2,
      )
      const { rerender } = render(
        <HooksStoreContextProvider availableNodesMetaData={initialCatalog}>
          <AvailableNodes />
        </HooksStoreContextProvider>,
      )
      const availableNodes = screen.getByRole('status', { name: 'Available nodes' })
      expect(availableNodes).toHaveTextContent(BlockEnum.KnowledgeRetrieval)
      expect(availableNodes).not.toHaveTextContent(BlockEnum.KnowledgeRetrievalV2)

      rerender(
        <HooksStoreContextProvider availableNodesMetaData={enabledCatalog}>
          <AvailableNodes />
        </HooksStoreContextProvider>,
      )
      expect(availableNodes).toHaveTextContent(BlockEnum.KnowledgeRetrievalV2)

      rerender(
        <HooksStoreContextProvider availableNodesMetaData={initialCatalog}>
          <AvailableNodes />
        </HooksStoreContextProvider>,
      )
      expect(availableNodes).toHaveTextContent(BlockEnum.KnowledgeRetrieval)
      expect(availableNodes).not.toHaveTextContent(BlockEnum.KnowledgeRetrievalV2)
    },
  )

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
