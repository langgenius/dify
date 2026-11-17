import { screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { TemplateDetailRouteProvider } from '../template-detail-route'

// Browser location.replace is non-configurable and would leave the test page. Keep this redirect boundary in unit.
describe('External template detail redirect', () => {
  const id = 'c558a1fb-bb8c-4a5e-9404-d681c6659cf2'
  it.each(['COMMUNITY', 'ENTERPRISE'] as const)(
    'replaces a legacy %s template detail URL with its official detail',
    (edition) => {
      const originalUrl = window.location.href
      onTestFinished(() => {
        vi.restoreAllMocks()
        window.history.replaceState(null, '', originalUrl)
      })
      window.history.replaceState(window.history.state, '', `/templates/dify/${id}`)
      const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
      renderWithConsoleQuery(
        <TemplateDetailRouteProvider initialSelection={{ publisher: 'dify', id }}>
          <span>catalog</span>
        </TemplateDetailRouteProvider>,
        { systemFeatures: { deployment_edition: edition } },
      )
      expect(replace).toHaveBeenCalledOnce()
      const url = new URL(replace.mock.calls[0]![0])
      expect(url.origin).toBe('https://marketplace.dify.ai')
      expect(url.pathname).toBe(`/template/dify/${id}`)
      expect(url.searchParams.get('source')).toBe(window.location.origin)
      expect(url.searchParams.has('view')).toBe(false)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    },
  )
})
