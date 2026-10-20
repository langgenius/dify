import type { ComponentProps } from 'react'
import type ImageUploader from '@/app/components/datasets/common/image-uploader/image-uploader-in-chunk'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IndexingType } from '@/app/components/datasets/create/step-two'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { ChunkingMode } from '@/models/datasets'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { SegmentDetail } from '../segment-detail'

// Mock dataset detail context
let mockIndexingTechnique: IndexingType = IndexingType.QUALIFIED
let mockRuntimeMode = 'general'
vi.mock('@/context/dataset-detail', () => ({
  useDatasetDetailContextWithSelector: (
    selector: (state: { dataset: { indexing_technique: string; runtime_mode: string } }) => unknown,
  ) => {
    return selector({
      dataset: {
        indexing_technique: mockIndexingTechnique,
        runtime_mode: mockRuntimeMode,
      },
    })
  },
}))

// Mock document context
let mockParentMode = 'paragraph'
let mockDocForm: ChunkingMode = ChunkingMode.text
let mockCanEdit = true
vi.mock('../../context', () => ({
  useDocumentContext: (
    selector: (state: { parentMode: string; canEdit: boolean; docForm: ChunkingMode }) => unknown,
  ) => {
    return selector({ parentMode: mockParentMode, canEdit: mockCanEdit, docForm: mockDocForm })
  },
}))

// Mock segment list context
let mockFullScreen = false
const mockToggleFullScreen = vi.fn()
vi.mock('../index', () => ({
  useSegmentListContext: (
    selector: (state: { fullScreen: boolean; toggleFullScreen: () => void }) => unknown,
  ) => {
    const state = {
      fullScreen: mockFullScreen,
      toggleFullScreen: mockToggleFullScreen,
    }
    return selector(state)
  },
}))

// Upload transport is covered by the uploader suite. Keep its public value contract here.
let uploaderProps: ComponentProps<typeof ImageUploader>
vi.mock('@/app/components/datasets/common/image-uploader/image-uploader-in-chunk', () => ({
  default: (props: ComponentProps<typeof ImageUploader>) => {
    uploaderProps = props
    return null
  },
}))
const segment = {
  id: 'segment-1',
  content: 'Original content',
  answer: 'Original answer',
  position: 1,
  word_count: 16,
  keywords: ['keyword1', 'keyword2'],
  attachments: [],
}
const props = {
  segInfo: segment,
  onUpdate: vi.fn(),
  onCancel: vi.fn(),
  isEditMode: true,
  docForm: ChunkingMode.text,
}
function setup(overrides: Partial<ComponentProps<typeof SegmentDetail>> = {}) {
  let emit!: (event: string) => void
  function CaptureEmitter() {
    const { eventEmitter } = useEventEmitterContextContext()
    emit = (event) => eventEmitter!.emit(event)
    return null
  }
  render(
    <EventEmitterContextProvider>
      <CaptureEmitter />
      <SegmentDetail {...props} {...overrides} />
    </EventEmitterContextProvider>,
  )
  return { emit: (event: string) => act(() => emit(event)) }
}
beforeEach(() => {
  mockFullScreen = false
  mockIndexingTechnique = IndexingType.QUALIFIED
  mockRuntimeMode = 'general'
  mockParentMode = 'paragraph'
  mockDocForm = ChunkingMode.text
  mockCanEdit = true
})

it('saves edited content with its segment identity and blocks duplicate saves during updates', async () => {
  const user = userEvent.setup()
  const { emit } = setup()
  const content = screen.getByRole('textbox', {
    name: 'datasetDocuments.segment.contentPlaceholder',
  })
  await user.clear(content)
  await user.type(content, 'Edited content')
  await user.click(screen.getByRole('button', { name: /common.operation.save/ }))
  expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith(
    'segment-1',
    'Edited content',
    'Original answer',
    ['keyword1', 'keyword2'],
    [],
    '',
    false,
  )
  emit('update-segment')
  const save = screen.getByRole('button', { name: /common.operation.save/ })
  expect(save).toBeDisabled()
  await user.click(save)
  expect(props.onUpdate).toHaveBeenCalledTimes(1)
  emit('update-segment-done')
  expect(save).toBeEnabled()
})

it('saves QA edits and updated economy keywords together', async () => {
  const user = userEvent.setup()
  mockIndexingTechnique = IndexingType.ECONOMICAL
  mockDocForm = ChunkingMode.qa
  setup({ docForm: ChunkingMode.qa })
  await user.clear(screen.getByRole('textbox', { name: 'ANSWER' }))
  await user.type(screen.getByRole('textbox', { name: 'ANSWER' }), 'Edited answer')
  await user.click(screen.getByRole('button', { name: 'common.operation.remove keyword1' }))
  await user.type(screen.getByPlaceholderText('datasetDocuments.segment.addKeyWord'), 'new{Enter}')
  await user.click(screen.getByRole('button', { name: /common.operation.save/ }))
  expect(props.onUpdate).toHaveBeenCalledWith(
    'segment-1',
    'Original content',
    'Edited answer',
    ['keyword2', 'new'],
    [],
    '',
    false,
  )
})

it('preserves loaded attachments and forwards uploaded attachment changes on save', async () => {
  const user = userEvent.setup()
  setup({
    segInfo: {
      ...segment,
      attachments: [
        {
          id: 'att-1',
          name: 'photo.jpg',
          size: 10,
          mime_type: 'image/jpeg',
          extension: 'jpg',
          source_url: '/photo.jpg',
        },
      ],
    },
  })
  expect(uploaderProps.value).toEqual([
    expect.objectContaining({ uploadedId: 'att-1', sourceUrl: '/photo.jpg', progress: 100 }),
  ])
  const added = {
    id: 'local-2',
    uploadedId: 'att-2',
    name: 'new.jpg',
    size: 20,
    mimeType: 'image/jpeg',
    extension: 'jpg',
    progress: 100,
  }
  act(() => uploaderProps.onChange([...uploaderProps.value!, added]))
  await user.click(screen.getByRole('button', { name: /common.operation.save/ }))
  expect(props.onUpdate).toHaveBeenCalledWith(
    'segment-1',
    'Original content',
    'Original answer',
    segment.keywords,
    [expect.objectContaining({ uploadedId: 'att-1' }), added],
    '',
    false,
  )
})

it.each([false, true])('withholds editing for view mode or readonly access (%s)', (readonly) => {
  mockCanEdit = !readonly
  setup({ isEditMode: readonly })
  expect(screen.queryByRole('button', { name: /common.operation.save/ })).not.toBeInTheDocument()
  expect(uploaderProps.disabled).toBe(true)
})

it('cancels a draft without saving', async () => {
  const user = userEvent.setup()
  setup()
  await user.type(
    screen.getByRole('textbox', { name: 'datasetDocuments.segment.contentPlaceholder' }),
    ' draft',
  )
  await user.click(screen.getByRole('button', { name: /common.operation.cancel/ }))
  expect(props.onCancel).toHaveBeenCalledOnce()
  expect(props.onUpdate).not.toHaveBeenCalled()
})

it('requires confirmation to regenerate parent-child segments and closes after successful regeneration', async () => {
  const user = userEvent.setup()
  mockDocForm = ChunkingMode.parentChild
  const { emit } = setup({ docForm: ChunkingMode.parentChild })
  await user.click(screen.getByRole('button', { name: 'common.operation.saveAndRegenerate' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.cancel',
    }),
  )
  expect(props.onUpdate).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'common.operation.saveAndRegenerate' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.regenerate',
    }),
  )
  expect(props.onUpdate).toHaveBeenCalledWith(
    'segment-1',
    'Original content',
    'Original answer',
    segment.keywords,
    [],
    '',
    true,
  )
  emit('update-segment')
  emit('update-segment-success')
  emit('update-segment-done')
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: /common.operation.close/ }),
  )
  expect(props.onCancel).toHaveBeenCalledOnce()
})

it('withholds manual regeneration for pipeline documents', () => {
  mockDocForm = ChunkingMode.parentChild
  mockRuntimeMode = 'rag_pipeline'
  setup({ docForm: ChunkingMode.parentChild })
  expect(
    screen.queryByRole('button', { name: 'common.operation.saveAndRegenerate' }),
  ).not.toBeInTheDocument()
})
