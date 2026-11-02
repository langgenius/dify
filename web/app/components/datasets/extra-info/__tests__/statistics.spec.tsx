import type { RelatedAppResponse } from '@dify/contracts/api/console/datasets/types.gen'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Statistics from '../statistics'

vi.mock('@/context/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/i18n')>()),
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))
const app: RelatedAppResponse = {
  id: 'app-1',
  name: 'Support assistant',
  description: '',
  mode: 'chat',
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFFFFF',
}

it('shows document and application counts and links to the connected application', async () => {
  const user = userEvent.setup()
  render(<Statistics expand documentCount={12} relatedApps={{ total: 1, data: [app] }} />)
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.getByText('1')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.datasetMenus.relatedApp' }))
  expect(await screen.findByRole('link', { name: /Support assistant/ })).toHaveAttribute(
    'href',
    '/app/app-1/overview',
  )
})

it('links to knowledge integration documentation when no applications use the dataset', async () => {
  const user = userEvent.setup()
  render(<Statistics expand documentCount={12} relatedApps={{ total: 0, data: [] }} />)
  await user.click(screen.getByRole('button', { name: 'common.datasetMenus.relatedApp' }))
  expect(await screen.findByRole('link', { name: 'common.datasetMenus.viewDoc' })).toHaveAttribute(
    'href',
    'https://docs.example.com/use-dify/knowledge/integrate-knowledge-within-application',
  )
})
