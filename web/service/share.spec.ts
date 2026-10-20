import type { Parameters as AppParameters } from '@dify/contracts/api/console/installed-apps/types.gen'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createHttpError } from './http-error'

const getMock = vi.hoisted(() => vi.fn())
const publicPost = vi.hoisted(() => vi.fn())
const request = vi.hoisted(() => vi.fn<typeof import('./base').request>())

vi.mock('./base', () => ({
  request,
  del: vi.fn(),
  delPublic: vi.fn(),
  get: vi.fn(),
  getPublic: getMock,
  patch: vi.fn(),
  patchPublic: vi.fn(),
  post: vi.fn(),
  postPublic: publicPost,
  ssePost: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('./webapp-auth', () => ({
  getOrCreateWebAppSessionId: vi.fn(() => 'webapp-session-1'),
  getWebAppAccessToken: vi.fn(() => ''),
}))

const {
  AppSourceType,
  fetchAccessToken,
  getUserCanAccess,
  stopChatMessageResponding,
  stopWorkflowMessage,
  pinConversation,
  unpinConversation,
  delConversation,
  renameConversation,
  saveMessage,
  removeMessage,
  updateFeedback,
  fetchMoreLikeThis,
  fetchSavedMessage,
  fetchSuggestedQuestions,
  fetchConversations,
  generationConversationName,
  fetchAppMeta,
  fetchAppParams,
  fetchChatList,
} = await import('./share')

describe('fetchAccessToken', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    getMock.mockReset()
  })

  afterEach(() => window.history.replaceState({}, '', originalUrl))

  it('shares an in-flight passport request for the same environment', async () => {
    window.history.replaceState({}, '', '/environment/workflow/environment-app')
    let resolveRequest: (value: { access_token: string }) => void = () => {}
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )

    const firstRequest = fetchAccessToken({ appCode: 'environment-app' })
    const secondRequest = fetchAccessToken({ appCode: 'environment-app' })

    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledWith('/passport?user_id=webapp-session-1', expect.anything())

    resolveRequest({ access_token: 'passport' })
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      { access_token: 'passport' },
      { access_token: 'passport' },
    ])

    await fetchAccessToken({ appCode: 'environment-app' })
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('does not coalesce ordinary Web App passport requests', async () => {
    window.history.replaceState({}, '', '/workflow/ordinary-app')
    getMock.mockResolvedValue({ access_token: 'passport' })

    await Promise.all([
      fetchAccessToken({ appCode: 'ordinary-app' }),
      fetchAccessToken({ appCode: 'ordinary-app' }),
    ])

    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('passes an embedded user id to the environment passport', async () => {
    window.history.replaceState({}, '', '/environment/workflow/environment-app')
    getMock.mockResolvedValue({ access_token: 'passport' })

    await fetchAccessToken({ appCode: 'environment-app', userId: 'iframe-user-123' })

    expect(getMock).toHaveBeenCalledWith('/passport?user_id=iframe-user-123', expect.anything())
  })

  it('starts a new environment passport request after a failure', async () => {
    window.history.replaceState({}, '', '/environment/workflow/environment-app')
    const error = createHttpError(new Response(null, { status: 401 }))
    getMock.mockRejectedValueOnce(error).mockResolvedValueOnce({ access_token: 'passport' })

    await expect(fetchAccessToken({ appCode: 'environment-app' })).rejects.toBe(error)
    await expect(fetchAccessToken({ appCode: 'environment-app' })).resolves.toEqual({
      access_token: 'passport',
    })

    expect(getMock).toHaveBeenCalledTimes(2)
  })
})

describe('getUserCanAccess', () => {
  beforeEach(() => {
    request.mockReset()
    getMock.mockReset()
  })

  it.each([true, false])('preserves the installed app permission result (%s)', async (allowed) => {
    request.mockResolvedValueOnce(Response.json({ result: allowed }))
    await expect(getUserCanAccess('app & special', true)).resolves.toEqual({ result: allowed })
    const url = new URL(request.mock.calls[0]![0])
    expect(url.pathname).toBe('/console/api/enterprise/webapp/permission')
    expect(url.searchParams.get('appId')).toBe('app & special')
    expect(request.mock.calls[0]?.[2]?.request?.method).toBe('GET')
    expect(getMock).not.toHaveBeenCalled()
  })

  it('keeps public app access checks on the public transport', async () => {
    getMock.mockResolvedValueOnce({ result: false })
    await expect(getUserCanAccess('shared-app', false)).resolves.toEqual({ result: false })
    expect(getMock).toHaveBeenCalledWith('/webapp/permission?appId=shared-app')
    expect(request).not.toHaveBeenCalled()
  })
})

describe('console commands shared with public apps', () => {
  beforeEach(() => {
    request
      .mockReset()
      .mockImplementation(async (_url, _init, options) =>
        options?.request?.method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json({ result: 'success' }),
      )
    publicPost.mockReset().mockResolvedValue({ result: 'success' })
  })

  it.each([
    { source: AppSourceType.installedApp, prefix: 'installed-apps' },
    { source: AppSourceType.tryApp, prefix: 'trial-apps' },
  ])('stops chat and workflow tasks through the $source contract', async ({ source, prefix }) => {
    await stopChatMessageResponding('underlying-app', 'chat-task', source, 'selected-app')
    await stopWorkflowMessage('underlying-app', 'workflow-task', source, 'selected-app')
    expect(request.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      `/console/api/${prefix}/selected-app/chat-messages/chat-task/stop`,
      `/console/api/${prefix}/selected-app/workflows/tasks/workflow-task/stop`,
    ])
    expect(request.mock.calls.map(([, , options]) => options?.request?.method)).toEqual([
      'POST',
      'POST',
    ])
    expect(publicPost).not.toHaveBeenCalled()
  })

  it('keeps public task cancellation on the public transport and ignores an absent workflow task', async () => {
    await stopChatMessageResponding('app', 'chat-task', AppSourceType.webApp)
    await stopWorkflowMessage('app', 'workflow-task', AppSourceType.webApp)
    await stopWorkflowMessage('app', '', AppSourceType.installedApp, 'installed')
    expect(publicPost.mock.calls).toEqual([
      ['chat-messages/chat-task/stop'],
      ['workflows/tasks/workflow-task/stop'],
    ])
    expect(request).not.toHaveBeenCalled()
  })

  it('uses the installed app identity for conversation commands and preserves the rename input', async () => {
    await pinConversation(AppSourceType.installedApp, 'installed-1', 'conversation-1')
    await unpinConversation(AppSourceType.installedApp, 'installed-1', 'conversation-1')
    await renameConversation(AppSourceType.installedApp, 'installed-1', 'conversation-1', '')
    await delConversation(AppSourceType.installedApp, 'installed-1', 'conversation-1')
    expect(
      request.mock.calls.map(([url, , options]) => [
        new URL(url).pathname,
        options?.request?.method,
      ]),
    ).toEqual([
      ['/console/api/installed-apps/installed-1/conversations/conversation-1/pin', 'PATCH'],
      ['/console/api/installed-apps/installed-1/conversations/conversation-1/unpin', 'PATCH'],
      ['/console/api/installed-apps/installed-1/conversations/conversation-1/name', 'POST'],
      ['/console/api/installed-apps/installed-1/conversations/conversation-1', 'DELETE'],
    ])
    expect(await request.mock.calls[2]?.[2]?.request?.json()).toEqual({ name: '' })
    expect(publicPost).not.toHaveBeenCalled()
  })

  it('saves and removes messages in the installed app scope', async () => {
    await saveMessage('message-1', AppSourceType.installedApp, 'installed-1')
    await removeMessage('message-1', AppSourceType.installedApp, 'installed-1')
    expect(
      request.mock.calls.map(([url, , options]) => [
        new URL(url).pathname,
        options?.request?.method,
      ]),
    ).toEqual([
      ['/console/api/installed-apps/installed-1/saved-messages', 'POST'],
      ['/console/api/installed-apps/installed-1/saved-messages/message-1', 'DELETE'],
    ])
    expect(await request.mock.calls[0]?.[2]?.request?.json()).toEqual({ message_id: 'message-1' })
  })

  it('propagates rejected console requests without retrying through the public API', async () => {
    const error = new Error('offline')
    request.mockRejectedValueOnce(error)
    await expect(
      stopWorkflowMessage('app', 'task', AppSourceType.installedApp, 'installed'),
    ).rejects.toThrow('offline')
    expect(request).toHaveBeenCalledOnce()
    expect(publicPost).not.toHaveBeenCalled()
  })
})

describe('console message queries and feedback', () => {
  beforeEach(() => {
    request.mockReset()
    getMock.mockReset()
    publicPost.mockReset()
  })

  it.each([
    { source: AppSourceType.installedApp, prefix: 'installed-apps' },
    { source: AppSourceType.tryApp, prefix: 'trial-apps' },
  ])('loads suggested questions for the selected $source message', async ({ source, prefix }) => {
    request.mockResolvedValueOnce(Response.json({ data: ['What next?'] }))
    await expect(fetchSuggestedQuestions('message-1', source, 'selected-app')).resolves.toEqual({
      data: ['What next?'],
    })
    expect(new URL(request.mock.calls[0]![0]).pathname).toBe(
      `/console/api/${prefix}/selected-app/messages/message-1/suggested-questions`,
    )
    expect(getMock).not.toHaveBeenCalled()
  })

  it('keeps saved-message errors silent and requests more-like-this in blocking mode', async () => {
    request.mockResolvedValueOnce(Response.json({ data: [] }))
    await expect(fetchSavedMessage(AppSourceType.installedApp, 'installed-1')).resolves.toEqual({
      data: [],
    })
    expect(new URL(request.mock.calls[0]![0]).pathname).toBe(
      '/console/api/installed-apps/installed-1/saved-messages',
    )
    expect(request.mock.calls[0]?.[2]?.silent).toBe(true)
    request.mockResolvedValueOnce(Response.json({ answer: 'Another answer' }))
    await expect(
      fetchMoreLikeThis('message-1', AppSourceType.installedApp, 'installed-1'),
    ).resolves.toEqual({ answer: 'Another answer' })
    const url = new URL(request.mock.calls[1]![0])
    expect(url.pathname).toBe(
      '/console/api/installed-apps/installed-1/messages/message-1/more-like-this',
    )
    expect(url.searchParams.get('response_mode')).toBe('blocking')
  })

  it('preserves cleared feedback and intentional empty comments', async () => {
    request.mockResolvedValueOnce(Response.json({ result: 'success' }))
    await updateFeedback(
      { messageId: 'message-1', body: { rating: null, content: '' } },
      AppSourceType.installedApp,
      'installed-1',
    )
    expect(new URL(request.mock.calls[0]![0]).pathname).toBe(
      '/console/api/installed-apps/installed-1/messages/message-1/feedbacks',
    )
    expect(await request.mock.calls[0]?.[2]?.request?.json()).toEqual({ rating: null, content: '' })
    expect(publicPost).not.toHaveBeenCalled()
  })

  it('keeps suggested questions and feedback for public apps on the public transport', async () => {
    getMock.mockResolvedValueOnce({ data: [] })
    await fetchSuggestedQuestions('message-1', AppSourceType.webApp)
    await updateFeedback({ messageId: 'message-1', body: { rating: 'like' } }, AppSourceType.webApp)
    expect(getMock).toHaveBeenCalledWith('/messages/message-1/suggested-questions')
    expect(publicPost).toHaveBeenCalledWith('/messages/message-1/feedbacks', {
      body: { rating: 'like' },
    })
    expect(request).not.toHaveBeenCalled()
  })
})

it('adapts nullable installed-app conversation introductions and preserves pagination filters', async () => {
  request.mockReset()
  const conversation = {
    id: 'conversation-1',
    name: '',
    inputs: {},
    status: 'normal',
    introduction: null,
  }
  request.mockResolvedValueOnce(Response.json({ data: [conversation], has_more: false, limit: 10 }))
  const result = await fetchConversations(
    AppSourceType.installedApp,
    'installed-1',
    'cursor-1',
    false,
    10,
  )
  expect(result).toEqual({
    data: [{ id: 'conversation-1', name: '', inputs: {}, introduction: '' }],
    has_more: false,
    limit: 10,
  })
  const url = new URL(request.mock.calls[0]![0])
  expect(url.pathname).toBe('/console/api/installed-apps/installed-1/conversations')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    last_id: 'cursor-1',
    pinned: 'false',
    limit: '10',
  })
  request.mockResolvedValueOnce(Response.json(conversation))
  await expect(
    generationConversationName(AppSourceType.installedApp, 'installed-1', 'conversation-1'),
  ).resolves.toEqual(result.data[0])
  expect(await request.mock.calls[1]?.[2]?.request?.json()).toEqual({ auto_generate: true })
})

it('loads installed-app metadata and initial chat history without sending the old ignored cursor', async () => {
  request.mockReset().mockResolvedValueOnce(Response.json({}))
  await expect(fetchAppMeta(AppSourceType.installedApp, 'installed-1')).resolves.toEqual({
    tool_icons: {},
  })
  expect(new URL(request.mock.calls[0]![0]).pathname).toBe(
    '/console/api/installed-apps/installed-1/meta',
  )
  request.mockResolvedValueOnce(Response.json({ data: [], has_more: false, limit: 20 }))
  await expect(
    fetchChatList('conversation-1', AppSourceType.installedApp, 'installed-1'),
  ).resolves.toEqual({ data: [], has_more: false, limit: 20 })
  const url = new URL(request.mock.calls[1]![0])
  expect(url.pathname).toBe('/console/api/installed-apps/installed-1/messages')
  expect(Object.fromEntries(url.searchParams)).toEqual({
    conversation_id: 'conversation-1',
    limit: '20',
  })
})

it.each([
  { source: AppSourceType.installedApp, prefix: 'installed-apps' },
  { source: AppSourceType.tryApp, prefix: 'trial-apps' },
])('loads $source parameters through the shared typed UI adapter', async ({ source, prefix }) => {
  const parameters: AppParameters = {
    opening_statement: null,
    suggested_questions: ['Next question'],
    suggested_questions_after_answer: { enabled: false },
    annotation_reply: {},
    file_upload: { enabled: false },
    more_like_this: {},
    retriever_resource: {},
    sensitive_word_avoidance: {},
    speech_to_text: { enabled: false },
    text_to_speech: {},
    system_parameters: {
      audio_file_size_limit: 1,
      file_size_limit: 2,
      image_file_size_limit: 3,
      video_file_size_limit: 4,
      workflow_file_upload_limit: 5,
    },
    user_input_form: [
      {
        'text-input': {
          variable: 'topic',
          label: 'Topic',
          default: '',
          required: false,
          max_length: 0,
        },
      },
      {
        checkbox: {
          variable: 'include_details',
          label: 'Details',
          default: false,
          required: false,
        },
      },
    ],
  }
  request.mockReset().mockResolvedValueOnce(Response.json(parameters))
  const result = await fetchAppParams(source, 'selected-app')
  expect(new URL(request.mock.calls[0]![0]).pathname).toBe(
    `/console/api/${prefix}/selected-app/parameters`,
  )
  expect(result).toMatchObject({
    opening_statement: '',
    suggested_questions: ['Next question'],
    suggested_questions_after_answer: { enabled: false },
    file_upload: { enabled: false },
    system_parameters: parameters.system_parameters,
    user_input_form: [
      { 'text-input': { variable: 'topic', default: '', required: false, max_length: 0 } },
      { checkbox: { variable: 'include_details', default: false, required: false } },
    ],
  })
})
