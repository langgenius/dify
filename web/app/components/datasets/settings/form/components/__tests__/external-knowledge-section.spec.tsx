import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import ExternalKnowledgeSection from '../external-knowledge-section'

it('shows the configured external API and keeps its retrieval controls read-only without edit permission', async () => {
  const user = userEvent.setup()
  const handleSettingsChange = vi.fn()
  const currentDataset = createDatasetFixture({
    provider: 'external',
    external_knowledge_info: {
      external_knowledge_id: 'knowledge-123',
      external_knowledge_api_id: 'api-1',
      external_knowledge_api_name: 'Product API',
      external_knowledge_api_endpoint: 'https://knowledge.example.com',
    },
  })
  render(
    <ExternalKnowledgeSection
      currentDataset={currentDataset}
      topK={5}
      scoreThreshold={0.8}
      scoreThresholdEnabled
      handleSettingsChange={handleSettingsChange}
      readonly
    />,
  )
  expect(screen.getByText('Product API')).toBeInTheDocument()
  expect(screen.getByText('https://knowledge.example.com')).toBeInTheDocument()
  expect(screen.getByText('knowledge-123')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toBeDisabled()
  expect(
    screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' }),
  ).toBeDisabled()
  const toggle = screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' })
  expect(toggle).toHaveAttribute('aria-disabled', 'true')
  await user.click(toggle)
  expect(handleSettingsChange).not.toHaveBeenCalled()
})
