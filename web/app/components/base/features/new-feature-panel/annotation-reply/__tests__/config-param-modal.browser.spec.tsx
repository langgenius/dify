import type { AnnotationReplyConfig } from '@/models/debug'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { AppToaster } from '@/app/notifications/app-toaster'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createDeferred } from '@/test/deferred'
import { createTestQueryClient } from '@/test/query-client'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderFeature } from '../../__tests__/feature-browser-test-env'
import ConfigParamModal from '../config-param-modal'

vi.unmock('react-i18next')
beforeEach(async () => {
  await page.viewport(1100, 800)
  onTestFinished(guardUnexpectedFetch())
})

const initialConfig: AnnotationReplyConfig = {
  id: 'test-id',
  enabled: false,
  score_threshold: 0.9,
  embedding_model: {
    embedding_provider_name: 'openai',
    embedding_model_name: 'text-embedding-ada-002',
  },
}

async function setup({
  config = initialConfig,
  available = true,
  save = async () => {},
}: { config?: AnnotationReplyConfig; available?: boolean; save?: () => Promise<void> } = {}) {
  const queryClient = createTestQueryClient()
  seedModelProviderQueries(
    queryClient,
    available
      ? [
          createModelCatalogFixture({
            models: [
              createCatalogModelFixture({
                model: 'text-embedding-ada-002',
                label: { en_US: 'Ada Embedding' },
                model_type: 'text-embedding',
              }),
            ],
          }),
          createModelCatalogFixture({
            provider: 'cohere',
            models: [
              createCatalogModelFixture({
                model: 'embed-english',
                label: { en_US: 'English Embedding' },
                model_type: 'text-embedding',
              }),
            ],
          }),
        ]
      : [],
  )
  function Settings() {
    const [open, setOpen] = useState(true)
    const [saved, setSaved] = useState(config)
    return (
      <>
        <output aria-label="Saved annotation settings">{JSON.stringify(saved)}</output>
        <button type="button" onClick={() => setOpen(true)}>
          Annotation settings
        </button>
        <ConfigParamModal
          appId="test-app"
          isShow={open}
          onHide={() => setOpen(false)}
          annotationConfig={config}
          onSave={async (embedding_model, score_threshold) => {
            await save()
            setSaved({ ...saved, embedding_model, score_threshold })
          }}
        />
        <AppToaster timeout={0} />
      </>
    )
  }
  return renderFeature(<Settings />, {}, { queryClient })
}

it('saves the selected embedding model and the score entered through native keyboard control', async () => {
  const { screen } = await setup()
  const dialog = screen.getByRole('dialog', { name: 'Annotation Reply Setup' })
  await dialog.getByRole('button', { name: /Ada Embedding/ }).click()
  await screen.getByRole('button', { name: /English Embedding/ }).click()
  const slider = dialog.getByRole('slider', { name: 'Score Threshold' })
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect
    .element(dialog.getByRole('button', { name: 'Embedding Model', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
  await expect.element(slider).toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect.element(slider).toHaveValue('0')
  await userEvent.keyboard('{ArrowRight}')
  await expect.element(slider).toHaveValue('0.01')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.element(screen.getByLabelText('Saved annotation settings')).toHaveTextContent(
    JSON.stringify({
      ...initialConfig,
      score_threshold: 0.01,
      embedding_model: {
        embedding_provider_name: 'cohere',
        embedding_model_name: 'embed-english',
      },
    }),
  )
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('preserves an explicitly saved zero score', async () => {
  const config = { ...initialConfig, score_threshold: 0 }
  const { screen } = await setup({ config })
  await expect.element(screen.getByRole('slider', { name: 'Score Threshold' })).toHaveValue('0')
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(screen.getByLabelText('Saved annotation settings'))
    .toHaveTextContent(JSON.stringify(config))
})

it('reports a missing embedding model without changing saved settings', async () => {
  const config = {
    ...initialConfig,
    embedding_model: { embedding_provider_name: '', embedding_model_name: '' },
  }
  const { screen } = await setup({ config, available: false })
  await screen.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .element(screen.getByRole('dialog', { name: 'Embedding Model is required' }))
    .toBeVisible()
  await expect
    .element(screen.getByLabelText('Saved annotation settings'))
    .toHaveTextContent(JSON.stringify(config))
})

it('keeps the setup open during a pending save and allows cancellation after settlement', async () => {
  const pending = createDeferred<void>()
  const { screen } = await setup({ save: () => pending.promise })
  const dialog = screen.getByRole('dialog', { name: 'Annotation Reply Setup' })
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await expect
    .element(dialog.getByRole('button', { name: 'Score Threshold', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(dialog.getByRole('slider')).toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect.element(dialog.getByRole('slider')).toHaveValue('0')
  await save.click()
  await expect.element(save).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).toBeVisible()
  pending.resolve(undefined)
  await expect
    .element(screen.getByLabelText('Saved annotation settings'))
    .toHaveTextContent(JSON.stringify({ ...initialConfig, score_threshold: 0 }))
  await expect.element(save).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})

it('shows a rejected save and restores controls for retry and closing', async () => {
  const pending = createDeferred<void>()
  let failed = false
  const { screen } = await setup({
    save: () => {
      if (!failed) {
        failed = true
        return pending.promise
      }
      return Promise.resolve()
    },
  })
  const dialog = screen.getByRole('dialog', { name: 'Annotation Reply Setup' })
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await expect
    .element(dialog.getByRole('button', { name: 'Score Threshold', exact: true }))
    .toHaveFocus()
  await userEvent.keyboard('{Tab}')
  await expect.element(dialog.getByRole('slider')).toHaveFocus()
  await userEvent.keyboard('{Home}')
  await expect.element(dialog.getByRole('slider')).toHaveValue('0')
  await save.click()
  await expect.element(save).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).toBeVisible()
  pending.reject(new Error('Vector index unavailable'))
  const error = screen.getByRole('dialog', { name: 'Vector index unavailable' })
  await expect.element(error).toBeVisible()
  await expect.element(save).toBeEnabled()
  await save.click()
  await expect
    .element(screen.getByLabelText('Saved annotation settings'))
    .toHaveTextContent(JSON.stringify({ ...initialConfig, score_threshold: 0 }))
  await expect.element(save).toBeEnabled()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.element(dialog).not.toBeInTheDocument()
})
