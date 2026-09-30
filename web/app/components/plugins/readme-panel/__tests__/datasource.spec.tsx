import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createDatasourceProvider } from '@/app/components/rag-pipeline/__tests__/datasource-fixtures'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { ReadmeEntrance } from '../entrance'
import ReadmePanel from '../index'
import { useReadmePanelStore } from '../store'

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.clearAllMocks()
  useReadmePanelStore.setState({ currentPanel: undefined })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({ readme: '# Datasource documentation' }))
})

afterEach(() => vi.unstubAllGlobals())

describe('datasource Readme', () => {
  it.each(['drawer', 'dialog'] as const)(
    'opens a raw catalog provider in a %s without installed-plugin metadata',
    async (presentation) => {
      const provider = createDatasourceProvider()
      provider.declaration.identity.label = { en_US: 'Datasource display name', zh_Hans: null }
      const user = userEvent.setup()
      render(
        <>
          <ReadmeEntrance pluginDetail={provider} presentation={presentation} />
          <ReadmePanel />
        </>,
      )
      const trigger = screen.getByRole('button', { name: 'plugin.readmeInfo.needHelpCheckReadme' })
      await user.click(trigger)
      await vi.dynamicImportSettled()
      expect(
        await screen.findByRole('heading', { name: 'Datasource documentation' }),
      ).toBeInTheDocument()
      expect(screen.getByText('Datasource display name')).toBeInTheDocument()
      expect(screen.getByText('Load files')).toBeInTheDocument()
      expect(document.querySelector('img[src="/datasource.svg"]')).toBeInTheDocument()
      expect(useReadmePanelStore.getState().currentPanel?.detail).toBe(provider)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [request] = fetchMock.mock.calls[0]!
      const url = new URL(request instanceof Request ? request.url : String(request))
      expect(url.pathname).toMatch(/\/workspaces\/current\/plugin\/readme$/)
      expect(Object.fromEntries(url.searchParams)).toEqual({
        plugin_unique_identifier: provider.plugin_unique_identifier,
        language: 'en_US',
      })
      expect(
        screen.queryByRole('button', { name: 'plugin.detailPanel.operation.update' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      await waitFor(() => expect(useReadmePanelStore.getState().currentPanel).toBeUndefined())
      await waitFor(() => expect(trigger).toHaveFocus())
    },
  )
})
