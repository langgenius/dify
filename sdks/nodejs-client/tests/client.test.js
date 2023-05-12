import { LangGeniusClient, BASE_URL } from "..";

import axios from 'axios'

jest.mock('axios')

describe('Client', () => {
  let langGeniusClient
  beforeEach(() => {
    langGeniusClient = new LangGeniusClient('test')
  })

  test('should create a client', () => {
    expect(langGeniusClient).toBeDefined();
  })
  // test updateApiKey
  test('should update the api key', () => {
    langGeniusClient.updateApiKey('test2');
    expect(langGeniusClient.apiKey).toBe('test2');
  })
});

describe('sendRequest', () => {
  let langGeniusClient

  beforeEach(() => {
    langGeniusClient = new LangGeniusClient('test')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('should make a successful request to the API', async () => {
    const method = 'GET'
    const endpoint = '/test-endpoint'
    const expectedResponse = { data: 'response' }
    axios.mockResolvedValue(expectedResponse)

    await langGeniusClient.sendRequest(method, endpoint)

    expect(axios).toHaveBeenCalledWith({
      method,
      url: `${BASE_URL}${endpoint}`,
      data: null,
      params: null,
      headers: {
        Authorization: `Bearer ${langGeniusClient.apiKey}`,
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

    await expect(langGeniusClient.sendRequest(method, endpoint)).rejects.toThrow(
      errorMessage
    )
  })
})