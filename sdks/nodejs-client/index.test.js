import { DifyClient, WorkflowClient, BASE_URL, routes } from ".";

import axios from 'axios'

jest.mock('axios')

afterEach(() => {
  jest.resetAllMocks()
})

describe('Client', () => {
  let difyClient
  beforeEach(() => {
    difyClient = new DifyClient('test')
  })

  test('should create a client', () => {
    expect(difyClient).toBeDefined();
  })
  // test updateApiKey
  test('should update the api key', () => {
    difyClient.updateApiKey('test2');
    expect(difyClient.apiKey).toBe('test2');
  })
});

describe('Send Requests', () => {
  let difyClient

  beforeEach(() => {
    difyClient = new DifyClient('test')
  })

  it('should make a successful request to the application parameter', async () => {
    const method = 'GET'
    const endpoint = routes.application.url()
    const expectedResponse = { data: 'response' }
    axios.mockResolvedValue(expectedResponse)

    await difyClient.sendRequest(method, endpoint)

    expect(axios).toHaveBeenCalledWith({
      method,
      url: `${BASE_URL}${endpoint}`,
      params: null,
      headers: {
        Authorization: `Bearer ${difyClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'json',
    })

  })

  it('should handle errors from the API', async () => {
    const method = 'GET'
    const endpoint = '/test-endpoint'
    const errorMessage = 'Request failed with status code 404'
    axios.mockRejectedValue(new Error(errorMessage))

    await expect(difyClient.sendRequest(method, endpoint)).rejects.toThrow(
      errorMessage
    )
  })

  it('uses the getMeta route configuration', async () => {
    axios.mockResolvedValue({ data: 'ok' })
    await difyClient.getMeta('end-user')

    expect(axios).toHaveBeenCalledWith({
      method: routes.getMeta.method,
      url: `${BASE_URL}${routes.getMeta.url()}`,
      params: { user: 'end-user' },
      headers: {
        Authorization: `Bearer ${difyClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'json',
    })
  })
})

describe('File uploads', () => {
  let difyClient
  const OriginalFormData = global.FormData

  beforeAll(() => {
    global.FormData = class FormDataMock {}
  })

  afterAll(() => {
    global.FormData = OriginalFormData
  })

  beforeEach(() => {
    difyClient = new DifyClient('test')
  })

  it('does not override multipart boundary headers for FormData', async () => {
    const form = new FormData()
    axios.mockResolvedValue({ data: 'ok' })

    await difyClient.fileUpload(form)

    expect(axios).toHaveBeenCalledWith({
      method: routes.fileUpload.method,
      url: `${BASE_URL}${routes.fileUpload.url()}`,
      data: form,
      params: null,
      headers: {
        Authorization: `Bearer ${difyClient.apiKey}`,
      },
      responseType: 'json',
    })
  })
})

describe('Workflow client', () => {
  let workflowClient

  beforeEach(() => {
    workflowClient = new WorkflowClient('test')
  })

  it('uses tasks stop path for workflow stop', async () => {
    axios.mockResolvedValue({ data: 'stopped' })
    await workflowClient.stop('task-1', 'end-user')

    expect(axios).toHaveBeenCalledWith({
      method: routes.stopWorkflow.method,
      url: `${BASE_URL}${routes.stopWorkflow.url('task-1')}`,
      data: { user: 'end-user' },
      params: null,
      headers: {
        Authorization: `Bearer ${workflowClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'json',
    })
  })
})
