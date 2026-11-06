import type { HttpNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'
import { AuthorizationType, BodyType, Method } from '../types'

const createData = (overrides: Partial<HttpNodeType> = {}): HttpNodeType => ({
  title: 'HTTP Request',
  desc: '',
  type: BlockEnum.HttpRequest,
  variables: [],
  method: Method.get,
  url: 'https://api.example.com',
  authorization: { type: AuthorizationType.none },
  headers: '',
  params: '',
  body: { type: BodyType.none, data: [] },
  timeout: { connect: 5, read: 10, write: 15 },
  ssl_verify: true,
  ...overrides,
})

const renderPanel = (readOnly = false, ready = true) =>
  renderNodePanel(Panel, createData(), {
    initialStoreState: {
      canvasReadOnly: readOnly,
      nodesDefaultConfigs: ready ? { [BlockEnum.HttpRequest]: createData() } : {},
    },
  })

describe('http/panel', () => {
  it('commits the selected method, body format and timeout from real controls', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    await user.click(screen.getByText('get'))
    await user.click(screen.getByText('POST'))
    expect(data().method).toBe(Method.post)
    await user.click(screen.getByRole('radio', { name: 'JSON' }))
    expect(data().body).toMatchObject({ type: BodyType.json })
    await user.click(
      screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.timeout.title' }),
    )
    const connect = screen.getByRole('textbox', {
      name: 'workflowIntegrations.nodes.http.timeout.connectLabel',
    })
    await user.clear(connect)
    await user.type(connect, '9')
    expect(data()).toMatchObject({
      method: Method.post,
      body: { type: BodyType.json },
      timeout: { connect: 9, read: 10, write: 15 },
    })
    await user.click(
      screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    ).toBeInTheDocument()
  })

  it('keeps request controls unavailable until config data is ready', () => {
    renderPanel(false, false)
    expect(screen.queryByRole('radio', { name: 'JSON' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    ).not.toBeInTheDocument()
  })

  it('blocks request changes in a read-only workflow', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel(true)
    expect(
      screen.queryByRole('button', { name: /authorization.authorization/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByText('get'))
    expect(screen.queryByText('POST')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'JSON' }))
    await user.click(screen.getByRole('switch'))
    await user.click(
      screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.timeout.title' }),
    )
    const connect = screen.getByRole('textbox', {
      name: 'workflowIntegrations.nodes.http.timeout.connectLabel',
    })
    expect(connect).toHaveAttribute('readonly')
    await user.type(connect, '9')
    expect(data()).toMatchObject(createData())
  })
})
