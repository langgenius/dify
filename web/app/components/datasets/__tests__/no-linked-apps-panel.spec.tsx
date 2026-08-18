import { render, screen } from '@testing-library/react'
import NoLinkedAppsPanel from '../no-linked-apps-panel'

vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

describe('NoLinkedAppsPanel', () => {
  it('links to the knowledge integration documentation', () => {
    render(<NoLinkedAppsPanel />)

    expect(screen.getByRole('link', { name: 'common.datasetMenus.viewDoc' })).toHaveAttribute(
      'href',
      'https://docs.example.com/use-dify/knowledge/integrate-knowledge-within-application',
    )
  })
})
