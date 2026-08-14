import { describe, expect, it, vi } from 'vite-plus/test'
import { generateMetadata as generateConnectMetadata } from '../connect/page'
import { generateMetadata as generatePipelineMetadata } from '../create-from-pipeline/page'
import { generateMetadata as generateCreateMetadata } from '../create/page'
import { generateMetadata as generateNewKnowledgeMetadata } from '../new/create/page'

vi.mock('server-only', () => ({}))

vi.mock('@/i18n-config/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n-config/server')>()),
  getLocaleOnServer: async () => 'en-US',
}))

describe('dataset creation document titles', () => {
  it.each([
    [generateConnectMetadata, 'Connect to an external knowledge base'],
    [generateCreateMetadata, 'Create a ready-to-use knowledge base'],
    [generatePipelineMetadata, 'Build a custom knowledge base'],
    [generateNewKnowledgeMetadata, 'Create Knowledge'],
  ])('provides localized route metadata', async (generateMetadata, expectedTitle) => {
    await expect(generateMetadata()).resolves.toMatchObject({ title: expectedTitle })
  })
})
