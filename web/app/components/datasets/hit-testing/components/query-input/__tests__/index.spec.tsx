import type { DatasetQueryContentResponse } from '@dify/contracts/api/console/datasets/types.gen'
import type { ComponentProps, ReactElement } from 'react'
import type { RetrievalConfig } from '@/types/app'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { fileUpload } from '@/app/components/base/file-uploader/utils'
import DatasetDetailContext from '@/context/dataset-detail'
import { expectLoadingButton } from '@/test/button'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDatasetFixture } from '@/test/fixtures/dataset'
import { mockFixtureImageFetch } from '@/test/image-fetch'
import { RETRIEVE_METHOD } from '@/types/app'
import QueryInput from '../index'

vi.mock('@/app/components/base/file-uploader/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/file-uploader/utils')>()),
  fileUpload: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'files.upload.get': async () => ({
        image_file_batch_limit: 10,
        single_chunk_attachment_limit: 20,
        attachment_image_file_size_limit: 15,
      }),
    }),
  }
})

const imageUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const dataset = createDatasetFixture({ is_multimodal: true })
function render(ui: ReactElement) {
  const wrap = (view: ReactElement) => (
    <DatasetDetailContext.Provider value={{ dataset }}>{view}</DatasetDetailContext.Provider>
  )
  const view = renderWithConsoleQuery(wrap(ui))
  return { ...view, rerender: (next: ReactElement) => view.rerender(wrap(next)) }
}

function ControlledQuery(props: ComponentProps<typeof QueryInput>) {
  const [queries, setQueries] = useState(props.queries)
  return <QueryInput {...props} queries={queries} setQueries={setQueries} />
}
function uploadResponse(file: File) {
  return {
    id: 'uploaded-1',
    name: file.name,
    size: file.size,
    mime_type: file.type,
    extension: 'gif',
    created_at: 0,
    created_by: 'user-1',
    preview_url: null,
    source_url: '',
  }
}
function imageFile() {
  return new File(
    [Uint8Array.from(atob(imageUrl.split(',')[1]!), (c) => c.charCodeAt(0))],
    'pic.gif',
    { type: 'image/gif' },
  )
}

describe('QueryInput', () => {
  // Re-create per test to avoid cross-test mutation (handleTextChange mutates query objects)
  const makeDefaultProps = () => ({
    onUpdateList: vi.fn(),
    setHitResult: vi.fn(),
    setExternalHitResult: vi.fn(),
    loading: false,
    queries: [
      { content: 'test query', content_type: 'text_query', file_info: null },
    ] satisfies DatasetQueryContentResponse[],
    setQueries: vi.fn(),
    isExternal: false,
    onClickRetrievalMethod: vi.fn(),
    retrievalConfig: {
      search_method: RETRIEVE_METHOD.semantic,
      reranking_enable: false,
      reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
      top_k: 3,
      score_threshold_enabled: false,
      score_threshold: 0.5,
    } satisfies RetrievalConfig,
    isEconomy: false,
    canRunRetrievalRecall: true,
    hitTestingMutation: vi.fn(),
    externalKnowledgeBaseHitTestingMutation: vi.fn(),
  })

  let defaultProps: ReturnType<typeof makeDefaultProps>

  beforeEach(() => {
    vi.clearAllMocks()
    defaultProps = makeDefaultProps()
    mockFixtureImageFetch()
    vi.mocked(fileUpload).mockImplementation(({ file, onSuccessCallback }) =>
      onSuccessCallback(uploadResponse(file)),
    )
  })

  it('labels the query input and focuses it when its visible label is clicked', async () => {
    const user = userEvent.setup()
    render(<QueryInput {...defaultProps} />)
    const textbox = screen.getByRole('textbox', { name: 'datasetHitTesting.input.title' })
    expect(textbox).toHaveValue('test query')
    await user.click(screen.getByText('datasetHitTesting.input.title'))
    expect(textbox).toHaveFocus()
  })

  it('supports keyboard activation of retrieval settings without submitting the query', async () => {
    const user = userEvent.setup()
    render(<QueryInput {...defaultProps} />)
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'dataset.retrieval.semantic_search.title' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(defaultProps.onClickRetrievalMethod).toHaveBeenCalledTimes(1)
    expect(defaultProps.hitTestingMutation).not.toHaveBeenCalled()
  })

  it('describes and announces the character limit error until the query is corrected', () => {
    const { rerender } = render(<QueryInput {...defaultProps} />)
    const textbox = screen.getByRole('textbox', { name: 'datasetHitTesting.input.title' })
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
    expect(textbox).not.toBeInvalid()

    rerender(
      <QueryInput
        {...defaultProps}
        queries={[{ content: 'a'.repeat(201), content_type: 'text_query', file_info: null }]}
      />,
    )
    expect(textbox).toBeInvalid()
    expect(textbox).toHaveAccessibleDescription('datasetHitTesting.input.countWarning')
    expect(screen.getByRole('alert')).toHaveTextContent('datasetHitTesting.input.countWarning')
    expect(screen.getByText('datasetHitTesting.input.countWarning')).toBeVisible()

    rerender(<QueryInput {...defaultProps} />)
    expect(textbox).not.toBeInvalid()
    expect(textbox).not.toHaveAccessibleDescription()
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })

  it('should disable submit button when text is empty', () => {
    const props = {
      ...defaultProps,
      queries: [
        { content: '', content_type: 'text_query', file_info: null },
      ] satisfies DatasetQueryContentResponse[],
    }
    render(<QueryInput {...props} />)
    expect(screen.getByRole('button', { name: /input\.testing/ }))!.toBeDisabled()
  })

  it('should disable submit button when text exceeds 200 characters', () => {
    const props = {
      ...defaultProps,
      queries: [
        { content: 'a'.repeat(201), content_type: 'text_query', file_info: null },
      ] satisfies DatasetQueryContentResponse[],
    }
    render(<QueryInput {...props} />)
    expect(screen.getByRole('button', { name: /input\.testing/ }))!.toBeDisabled()
  })

  it('should show loading state on submit button when loading', () => {
    render(<QueryInput {...defaultProps} loading={true} />)
    const submitButton = screen.getByRole('button', { name: /input\.testing/ })
    expectLoadingButton(submitButton)
  })

  describe('External retrieval settings', () => {
    it('keeps parameter edits outside the query form and submits saved settings', async () => {
      const user = userEvent.setup()
      render(<QueryInput {...defaultProps} isExternal />)
      await user.click(screen.getByRole('button', { name: 'datasetHitTesting.settingTitle' }))
      const topK = screen.getByRole('textbox', {
        name: 'appDebug.datasetConfig.top_k',
      }) as HTMLInputElement
      expect(topK.form).toBeNull()
      await user.click(topK)
      await user.keyboard('{Enter}')
      expect(defaultProps.externalKnowledgeBaseHitTestingMutation).not.toHaveBeenCalled()
      await user.type(topK, '0')
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      expect(
        screen.queryByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }),
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /input.testing/ }))
      expect(defaultProps.externalKnowledgeBaseHitTestingMutation).toHaveBeenCalledWith(
        {
          query: 'test query',
          external_retrieval_model: {
            top_k: 10,
            score_threshold: 0.5,
            score_threshold_enabled: false,
          },
        },
        expect.anything(),
      )
    })

    it('discards canceled external settings', async () => {
      const user = userEvent.setup()
      render(<QueryInput {...defaultProps} isExternal />)
      await user.click(screen.getByRole('button', { name: 'datasetHitTesting.settingTitle' }))
      await user.type(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }), '0')
      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await user.click(screen.getByRole('button', { name: 'datasetHitTesting.settingTitle' }))
      expect(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })).toHaveValue('4')
      expect(defaultProps.externalKnowledgeBaseHitTestingMutation).not.toHaveBeenCalled()
    })
  })

  describe('Text Change Handling', () => {
    it.each([
      {
        queries: [
          { content: 'test query', content_type: 'text_query', file_info: null },
        ] satisfies DatasetQueryContentResponse[],
        next: 'updated text',
      },
      { queries: [], next: 'new text' },
    ])('saves $next in the live query and submitted request', async ({ queries, next }) => {
      const user = userEvent.setup()
      render(<ControlledQuery {...defaultProps} queries={queries} />)
      const textarea = screen.getByRole('textbox', { name: 'datasetHitTesting.input.title' })
      await user.clear(textarea)
      await user.type(textarea, next)
      expect(textarea).toHaveValue(next)
      await user.click(screen.getByRole('button', { name: /input\.testing/ }))
      expect(defaultProps.hitTestingMutation).toHaveBeenCalledWith(
        expect.objectContaining({ query: next }),
        expect.anything(),
      )
    })
  })

  describe('Permission Guarding', () => {
    it('should not run hit testing mutation when retrieval recall permission is missing', async () => {
      const user = userEvent.setup()
      render(<QueryInput {...defaultProps} canRunRetrievalRecall={false} />)

      await user.click(screen.getByRole('button', { name: /input\.testing/ }))

      expect(defaultProps.hitTestingMutation).not.toHaveBeenCalled()
    })
  })

  it.each([false, true])(
    'blocks native form submission while invalid or pending (external: %s)',
    (isExternal) => {
      const { rerender } = render(<QueryInput {...defaultProps} isExternal={isExternal} loading />)
      const textbox = screen.getByRole('textbox', {
        name: 'datasetHitTesting.input.title',
      }) as HTMLTextAreaElement
      expect(textbox.form).not.toBeNull()
      fireEvent.submit(textbox.form!)
      expect(defaultProps.hitTestingMutation).not.toHaveBeenCalled()
      expect(defaultProps.externalKnowledgeBaseHitTestingMutation).not.toHaveBeenCalled()

      rerender(
        <QueryInput
          {...defaultProps}
          isExternal={isExternal}
          queries={[{ content: 'a'.repeat(201), content_type: 'text_query', file_info: null }]}
        />,
      )
      fireEvent.submit(textbox.form!)
      expect(defaultProps.hitTestingMutation).not.toHaveBeenCalled()
      expect(defaultProps.externalKnowledgeBaseHitTestingMutation).not.toHaveBeenCalled()
    },
  )

  describe('Image Change Handling', () => {
    it('uploads an image and submits its saved identifier alongside the existing text', async () => {
      const user = userEvent.setup()
      const { container } = render(<ControlledQuery {...defaultProps} />)
      const file = imageFile()
      await user.upload(container.querySelector<HTMLInputElement>('input[type="file"]')!, file)
      expect(await screen.findByRole('img', { name: 'Preview' })).toBeVisible()
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /input\.testing/ })).toBeEnabled(),
      )
      await user.click(screen.getByRole('button', { name: /input\.testing/ }))
      expect(fileUpload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ file }))
      expect(defaultProps.hitTestingMutation).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'test query', attachment_ids: ['uploaded-1'] }),
        expect.anything(),
      )
    })

    it('removes an existing image without losing the text query', async () => {
      const user = userEvent.setup()
      const queries: DatasetQueryContentResponse[] = [
        { content: 'text', content_type: 'text_query', file_info: null },
        {
          content: imageUrl,
          content_type: 'image_query',
          file_info: {
            id: 'old',
            name: 'old.gif',
            size: 100,
            mime_type: 'image/gif',
            extension: 'gif',
            source_url: imageUrl,
          },
        },
      ]
      render(<ControlledQuery {...defaultProps} queries={queries} />)
      expect(await screen.findByRole('img', { name: 'Preview' })).toBeVisible()
      await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
      expect(screen.queryByRole('img', { name: 'Preview' })).not.toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'datasetHitTesting.input.title' })).toHaveValue(
        'text',
      )
      await user.click(screen.getByRole('button', { name: /input\.testing/ }))
      expect(defaultProps.hitTestingMutation).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'text', attachment_ids: [] }),
        expect.anything(),
      )
    })
  })

  describe('Submit Handlers', () => {
    it('should call hitTestingMutation on submit for non-external mode', async () => {
      const user = userEvent.setup()
      const mockMutation = vi.fn(async (_req, opts) => {
        const response = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
        opts?.onSuccess?.(response)
        return response
      })

      const onSubmit = vi.fn()
      render(<QueryInput {...defaultProps} hitTestingMutation={mockMutation} onSubmit={onSubmit} />)

      await user.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'test query',
            retrieval_model: expect.objectContaining({ search_method: 'semantic_search' }),
          }),
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        )
      })
      expect(defaultProps.setHitResult).toHaveBeenCalledWith({
        query: { content: '', tsne_position: { x: 0, y: 0 } },
        records: [],
      })
      expect(defaultProps.onUpdateList).toHaveBeenCalledOnce()
      expect(onSubmit).toHaveBeenCalledOnce()
    })

    it('should use keywordSearch when isEconomy is true', async () => {
      const user = userEvent.setup()
      const mockResponse = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
      const mockMutation = vi.fn(async (_req, opts) => {
        opts?.onSuccess?.(mockResponse)
        return mockResponse
      })

      render(<QueryInput {...defaultProps} hitTestingMutation={mockMutation} isEconomy={true} />)

      await user.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            retrieval_model: expect.objectContaining({ search_method: 'keyword_search' }),
          }),
          expect.anything(),
        )
      })
    })

    it('should call externalKnowledgeBaseHitTestingMutation for external mode', async () => {
      const user = userEvent.setup()
      const mockExternalMutation = vi.fn(async (_req, opts) => {
        const response = { query: { content: '' }, records: [] }
        opts?.onSuccess?.(response)
        return response
      })

      render(
        <QueryInput
          {...defaultProps}
          isExternal={true}
          externalKnowledgeBaseHitTestingMutation={mockExternalMutation}
        />,
      )

      await user.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockExternalMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            query: 'test query',
            external_retrieval_model: expect.objectContaining({
              top_k: 4,
              score_threshold: 0.5,
              score_threshold_enabled: false,
            }),
          }),
          expect.objectContaining({ onSuccess: expect.any(Function) }),
        )
      })
      expect(defaultProps.setExternalHitResult).toHaveBeenCalledWith({
        query: { content: '' },
        records: [],
      })
      expect(defaultProps.onUpdateList).toHaveBeenCalled()
    })

    it('should include image attachment_ids in submit request', async () => {
      const user = userEvent.setup()
      const queries: DatasetQueryContentResponse[] = [
        { content: 'test', content_type: 'text_query', file_info: null },
        {
          content: imageUrl,
          content_type: 'image_query',
          file_info: {
            id: 'img-id',
            name: 'pic.png',
            size: 100,
            mime_type: 'image/png',
            extension: 'png',
            source_url: imageUrl,
          },
        },
      ]
      const mockResponse = { query: { content: '', tsne_position: { x: 0, y: 0 } }, records: [] }
      const mockMutation = vi.fn(async (_req, opts) => {
        opts?.onSuccess?.(mockResponse)
        return mockResponse
      })

      render(<QueryInput {...defaultProps} queries={queries} hitTestingMutation={mockMutation} />)

      await user.click(screen.getByRole('button', { name: /input\.testing/ }))

      await waitFor(() => {
        expect(mockMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            // uploadedId is mapped from file_info.id
            attachment_ids: expect.arrayContaining(['img-id']),
          }),
          expect.anything(),
        )
      })
    })
  })

  describe('Retrieval Method', () => {
    it('should show keyword_search when isEconomy is true', () => {
      render(<QueryInput {...defaultProps} isEconomy={true} />)

      expect(screen.getByText('dataset.retrieval.keyword_search.title'))!.toBeInTheDocument()
    })
  })
})
