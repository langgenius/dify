import type { ReactElement } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import {
  createCatalogModelFixture,
  createModelCatalogFixture,
  seedModelProviderQueries,
} from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import {
  createModelConfigFixture,
  createPublishedConfigurationFixture,
} from '@/test/fixtures/debug-configuration'
import { Resolution, TransferMethod } from '@/types/app'
import FeaturesWrappedAppPublisher from '../features-wrapper'

const mockOnPublish = vi.fn()
const mockFeatures = {
  moreLikeThis: { enabled: false },
  opening: { enabled: false, opening_statement: '', suggested_questions: [] as string[] },
  moderation: { enabled: false },
  speech2text: { enabled: false },
  text2speech: { enabled: false },
  suggested: { enabled: false },
  citation: { enabled: false },
  annotationReply: { enabled: false },
  file: {
    image: {
      detail: Resolution.high,
      enabled: false,
      number_limits: 3,
      transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    },
    enabled: false,
    allowed_file_types: [SupportUploadFileTypes.image],
    allowed_file_extensions: ['.png'],
    allowed_file_upload_methods: [TransferMethod.local_file],
    number_limits: 3,
  },
}
let store: ReturnType<typeof createFeaturesStore>
function render(ui: ReactElement) {
  store = createFeaturesStore({ features: mockFeatures })
  const { queryClient } = createConsoleQueryWrapper()
  seedAppDetail(queryClient, createAppDetailFixture({ id: 'app-1', mode: 'chat' }))
  seedModelProviderQueries(queryClient, [
    createModelCatalogFixture({
      provider: 'openai',
      models: [createCatalogModelFixture({ model: 'gpt-4o', label: { en_US: 'GPT-4o' } })],
    }),
  ])
  return renderWorkflowComponent(<FeaturesContext value={store}>{ui}</FeaturesContext>, {
    queryClient,
  })
}

describe('FeaturesWrappedAppPublisher', () => {
  const resetAppConfig = vi.fn()
  const publishedConfig = createPublishedConfigurationFixture({
    modelConfig: createModelConfigFixture({
      more_like_this: { enabled: true },
      opening_statement: 'Hello there',
      suggested_questions: ['Q1'],
      sensitive_word_avoidance: { enabled: true },
      speech_to_text: { enabled: true },
      text_to_speech: { enabled: true },
      suggested_questions_after_answer: { enabled: true },
      retriever_resource: { enabled: true },
      annotation_reply: {
        enabled: true,
        id: 'annotation-1',
        score_threshold: 0.7,
        embedding_model: { embedding_model_name: 'embedding', embedding_provider_name: 'openai' },
      },
      file_upload: {
        enabled: true,
        image: {
          enabled: true,
          detail: 'low',
          number_limits: 5,
          transfer_methods: ['remote_url'],
        },
        allowed_file_types: [SupportUploadFileTypes.image],
        allowed_file_extensions: ['.jpg'],
        allowed_file_upload_methods: ['remote_url'],
        number_limits: 5,
      },
    }),
  })

  it('should pass current features through to onPublish', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedAt={1710000100000}
        publishedConfig={publishedConfig}
        onPublish={mockOnPublish}
        debugWithMultipleModel
        multipleModelConfigs={[
          { id: 'model-1', model: 'gpt-4o', provider: 'openai', parameters: {} },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.applyConfig' }))
    await user.click(await screen.findByRole('menuitem', { name: /GPT-4o/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'appDebug.operation.applyConfig' })).toBeDisabled(),
    )

    await waitFor(() => {
      expect(mockOnPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'model-1',
          model: 'gpt-4o',
          provider: 'openai',
          parameters: {},
        }),
        mockFeatures,
      )
    })
  })

  it('should restore published features after confirmation', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedAt={1710000100000}
        publishedConfig={publishedConfig}
        resetAppConfig={resetAppConfig}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
    expect(store.getState().features).toEqual(mockFeatures)
    expect(resetAppConfig).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /(?:^|\.)operation\.confirm(?=$|:)/ }))

    await waitFor(() => {
      expect(resetAppConfig).toHaveBeenCalledTimes(1)
      expect(store.getState().features).toEqual(
        expect.objectContaining({
          moreLikeThis: { enabled: true },
          opening: {
            enabled: true,
            opening_statement: 'Hello there',
            suggested_questions: ['Q1'],
          },
          moderation: { enabled: true },
          speech2text: { enabled: true },
          text2speech: { enabled: true },
          suggested: { enabled: true },
          citation: { enabled: true },
          annotationReply: publishedConfig.modelConfig.annotation_reply,
          file: publishedConfig.modelConfig.file_upload,
        }),
      )
    })
  })

  it('should close restore confirmation without restoring when cancelled', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesWrappedAppPublisher
        appId="app-1"
        publishedAt={1710000100000}
        publishedConfig={publishedConfig}
        resetAppConfig={resetAppConfig}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.common.publish' }))
    await user.click(screen.getByRole('button', { name: 'workflow.common.restore' }))
    const dialog = screen.getByRole('alertdialog')

    await user.click(
      within(dialog).getByRole('button', { name: /(?:^|\.)operation\.cancel(?=$|:)/ }),
    )

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    expect(resetAppConfig).not.toHaveBeenCalled()
    expect(store.getState().features).toEqual(mockFeatures)
  })
})
