import { page, userEvent } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderChat } from '../../__tests__/chat-browser-test-env'
import Citation from '../index'
import { citation } from './citation-preset'

vi.unmock('react-i18next')
// boundary: citation links retain their destinations without the Next router runtime.
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

beforeEach(async () => {
  await page.viewport(900, 700)
  onTestFinished(guardUnexpectedFetch())
})

it('reveals the source dataset and live metric explanations from the citation owner', async () => {
  const screen = await renderChat(<Citation data={[citation()]} showHitInfo />)
  const trigger = screen.getByRole('button', { name: 'Document One' })
  await trigger.click()
  const dialog = screen.getByRole('dialog')
  await dialog.getByText('Evidence passage').hover()
  await expect.element(dialog.getByRole('link', { name: 'Link to Knowledge' })).toBeVisible()
  await expect
    .element(dialog.getByRole('link', { name: 'Link to Knowledge' }))
    .toHaveAttribute('href', '/datasets/dataset-1/documents/doc-1')
  await dialog.getByRole('button', { name: '55', exact: true }).hover()
  await expect.element(screen.getByText('Characters: 55')).toBeVisible()
  await dialog.getByRole('button', { name: '0.3', exact: true }).hover()
  await expect.element(screen.getByText('Retrieval Score: 0.3')).toBeVisible()
  await screen.rerender(<Citation data={[citation({ score: 0.9 })]} showHitInfo />)
  await expect.element(dialog.getByRole('button', { name: '0.9', exact: true })).toBeVisible()
  await expect.element(screen.getByText('Retrieval Score: 0.9')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByText('Retrieval Score: 0.9')).not.toBeInTheDocument()
})
