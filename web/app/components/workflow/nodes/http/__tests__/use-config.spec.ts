import type { HttpNodeType } from '../types'
import { act, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderNodeConfig } from '../../__tests__/render-node-config'
import { parseCurl } from '../components/curl-parser'
import { APIType, AuthorizationType, BodyPayloadValueType, BodyType, Method } from '../types'
import useConfig from '../use-config'
const createPayload = (overrides: Partial<HttpNodeType> = {}): HttpNodeType => ({
  title: 'HTTP Request',
  desc: '',
  type: BlockEnum.HttpRequest,
  variables: [],
  method: Method.get,
  url: 'https://api.example.com',
  authorization: { type: AuthorizationType.none },
  headers: 'accept:application/json',
  params: 'page:1',
  body: {
    type: BodyType.json,
    data: '{"name":"alice"}',
  },
  timeout: { connect: 5, read: 10, write: 15 },
  ssl_verify: true,
  ...overrides,
})

const renderConfig = (data = createPayload()) =>
  renderNodeConfig(useConfig, data, {
    initialStoreState: { nodesDefaultConfigs: { [BlockEnum.HttpRequest]: createPayload() } },
  })

describe('http/use-config', () => {
  it('waits for defaults then normalizes persisted legacy body data', async () => {
    const payload = createPayload()
    const { result, store } = renderNodeConfig(useConfig, payload)
    expect(result.current.config.isDataReady).toBe(false)
    expect(result.current.flow.getNode('node')?.data).toMatchObject(payload)
    act(() =>
      store.setState({
        nodesDefaultConfigs: {
          [BlockEnum.HttpRequest]: createPayload({
            method: Method.post,
            url: 'https://default.example.com',
          }),
        },
      }),
    )
    await waitFor(() => expect(result.current.config.isDataReady).toBe(true))
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      method: Method.get,
      url: payload.url,
      body: {
        type: BodyType.json,
        data: [{ type: BodyPayloadValueType.text, value: '{"name":"alice"}' }],
      },
    })
    expect(result.current.config.headers).toEqual([
      expect.objectContaining({ key: 'accept', value: 'application/json' }),
    ])
  })
  it('normalizes legacy missing form body data to an editable empty list', () => {
    const { result } = renderConfig(
      createPayload({
        body: {
          type: BodyType.formData,
          data: undefined as unknown as HttpNodeType['body']['data'],
        },
      }),
    )
    expect(result.current.flow.getNode('node')?.data.body).toEqual({
      type: BodyType.formData,
      data: [],
    })
  })
  it.each([
    {
      command: 'curl --json \'{"ok":true}\' https://example.com/items',
      type: BodyType.json,
      data: [{ type: BodyPayloadValueType.text, value: '{"ok":true}' }],
    },
    {
      command: 'curl --form "name=openai" https://example.com/upload',
      type: BodyType.formData,
      data: [expect.objectContaining({ key: 'name', value: 'openai' })],
    },
  ])(
    'imports $type curl data without resetting authorization or timeout edits',
    ({ command, type, data }) => {
      const { result } = renderConfig()
      const authorization = {
        type: AuthorizationType.apiKey,
        config: { type: APIType.bearer, api_key: 'secret' },
      }
      const timeout = { connect: 30, read: 40, write: 50 }
      act(() => result.current.config.setAuthorization(authorization))
      act(() => result.current.config.setTimeout(timeout))
      const parsed = parseCurl(command)
      expect(parsed.error).toBeNull()
      act(() => result.current.config.handleCurlImport(parsed.node!))
      act(() => result.current.config.handleSSLVerifyChange(false))
      expect(result.current.flow.getNode('node')?.data).toMatchObject({
        body: { type, data },
        authorization,
        timeout,
        ssl_verify: false,
        url: parsed.node!.url,
      })
    },
  )
  it('keeps request edits while the real key-value helpers serialize headers and params', () => {
    const { result } = renderConfig()
    act(() => result.current.config.handleMethodChange(Method.delete))
    act(() => result.current.config.handleUrlChange('https://changed.example.com'))
    act(() => result.current.config.setHeaders([{ id: 'h', key: 'x-token', value: '123' }]))
    act(() => result.current.config.setParams([{ id: 'p', key: 'size', value: '20' }]))
    act(() =>
      result.current.config.setBody({
        type: BodyType.rawText,
        data: [{ type: BodyPayloadValueType.text, value: 'raw payload' }],
      }),
    )
    expect(result.current.flow.getNode('node')?.data).toMatchObject({
      method: Method.delete,
      url: 'https://changed.example.com',
      headers: 'x-token:123',
      params: 'size:20',
      body: {
        type: BodyType.rawText,
        data: [{ type: BodyPayloadValueType.text, value: 'raw payload' }],
      },
    })
  })
})
