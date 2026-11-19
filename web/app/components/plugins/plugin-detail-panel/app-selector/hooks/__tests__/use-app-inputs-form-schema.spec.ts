import type { WorkflowResponse } from '@dify/contracts/api/console/apps/types.gen'
import { act, waitFor } from '@testing-library/react'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture, createAppModelConfigFixture } from '@/test/fixtures/app'
import { Resolution } from '@/types/app'
import { useAppInputsFormSchema } from '../use-app-inputs-form-schema'

const { fetchApp, fetchWorkflow, fetchUploadConfig } = vi.hoisted(() => ({
  fetchApp: vi.fn(),
  fetchWorkflow: vi.fn(),
  fetchUploadConfig: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.get': fetchApp,
      'apps.byAppId.workflows.publish.get': fetchWorkflow,
      'files.upload.get': fetchUploadConfig,
    }),
  }
})
const uploadConfig = {
  attachment_image_file_size_limit: 10,
  audio_file_size_limit: 50,
  batch_count_limit: 5,
  file_size_limit: 15,
  file_upload_limit: 5,
  image_file_batch_limit: 5,
  image_file_size_limit: 10,
  knowledge_file_size_limit: 15,
  single_chunk_attachment_limit: 10,
  skill_file_size_limit: 15,
  video_file_size_limit: 100,
  workflow_file_upload_limit: 5,
}
const workflow: WorkflowResponse = {
  id: 'workflow-1',
  version: '1',
  hash: 'hash',
  created_at: 1,
  updated_at: 1,
  conversation_variables: [],
  environment_variables: [],
  rag_pipeline_variables: [],
  marked_comment: '',
  marked_name: '',
  tool_published: false,
  graph: {
    nodes: [
      {
        data: {
          type: BlockEnum.Start,
          variables: [
            { label: 'Attachments', variable: 'attachments', type: InputVarType.multiFiles },
          ],
        },
      },
    ],
  },
  features: {},
}
const textInput = { 'text-input': { label: 'Question', variable: 'question' } }

beforeEach(() => {
  fetchUploadConfig.mockResolvedValue(uploadConfig)
  fetchApp.mockResolvedValue(
    createAppDetailFixture({
      model_config: createAppModelConfigFixture({ user_input_form: [textInput] }),
    }),
  )
  fetchWorkflow.mockResolvedValue(workflow)
})

it('builds completion app inputs and includes the configured image restrictions', async () => {
  fetchApp.mockResolvedValue(
    createAppDetailFixture({
      mode: 'completion',
      model_config: createAppModelConfigFixture({
        user_input_form: [textInput],
        file_upload: {
          enabled: true,
          image: {
            enabled: true,
            detail: Resolution.high,
            number_limits: 2,
            transfer_methods: ['local_file'],
          },
          allowed_file_types: [SupportUploadFileTypes.image],
          allowed_file_extensions: ['.png'],
          allowed_file_upload_methods: ['local_file'],
          number_limits: 2,
        },
      }),
    }),
  )
  const { result } = renderHookWithConsoleQuery(() =>
    useAppInputsFormSchema({ appDetail: { id: 'app-1', mode: 'completion' } }),
  )
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.inputFormSchema).toEqual([
    expect.objectContaining({ variable: 'question', type: 'text-input' }),
    expect.objectContaining({
      variable: '#image#',
      type: InputVarType.singleFile,
      allowed_file_extensions: ['.png'],
      number_limits: 2,
      fileUploadConfig: uploadConfig,
    }),
  ])
  expect(fetchWorkflow).not.toHaveBeenCalled()
})

it('builds workflow inputs from start node variables using the upload limits', async () => {
  fetchApp.mockResolvedValue(createAppDetailFixture({ id: 'app-2', mode: 'workflow' }))
  const { result } = renderHookWithConsoleQuery(() =>
    useAppInputsFormSchema({ appDetail: { id: 'app-2', mode: 'workflow' } }),
  )
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.inputFormSchema).toEqual([
    expect.objectContaining({
      variable: 'attachments',
      type: InputVarType.multiFiles,
      fileUploadConfig: uploadConfig,
    }),
  ])
})

it('reports an unavailable app without exposing input fields', async () => {
  fetchApp.mockRejectedValue(new Error('App unavailable'))
  const { result } = renderHookWithConsoleQuery(() =>
    useAppInputsFormSchema({ appDetail: { id: 'missing-app', mode: 'chat' } }),
  )
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.inputFormSchema).toEqual([])
})

it('keeps text inputs usable when the upload-limit request fails', async () => {
  fetchUploadConfig.mockRejectedValue(new Error('Upload limits unavailable'))
  const { result } = renderHookWithConsoleQuery(() =>
    useAppInputsFormSchema({ appDetail: { id: 'app-1', mode: 'chat' } }),
  )
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(result.current.isError).toBe(false)
  expect(result.current.inputFormSchema).toEqual([
    expect.objectContaining({ type: 'text-input', variable: 'question' }),
  ])
})

it('retries all workflow panel queries and replaces the failed state with inputs', async () => {
  fetchApp
    .mockRejectedValueOnce(new Error('App unavailable'))
    .mockResolvedValue(createAppDetailFixture({ id: 'app-2', mode: 'workflow' }))
  fetchWorkflow.mockRejectedValueOnce(new Error('Workflow unavailable'))
  fetchUploadConfig.mockRejectedValueOnce(new Error('Upload limits unavailable'))
  const { result } = renderHookWithConsoleQuery(() =>
    useAppInputsFormSchema({ appDetail: { id: 'app-2', mode: 'workflow' } }),
  )
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isError).toBe(true)
  })
  act(() => result.current.retry())
  await waitFor(() =>
    expect(result.current.inputFormSchema).toEqual([
      expect.objectContaining({ variable: 'attachments', fileUploadConfig: uploadConfig }),
    ]),
  )
  expect(result.current.isError).toBe(false)
  expect(fetchApp).toHaveBeenCalledTimes(2)
  expect(fetchWorkflow).toHaveBeenCalledTimes(2)
  expect(fetchUploadConfig).toHaveBeenCalledTimes(2)
})
