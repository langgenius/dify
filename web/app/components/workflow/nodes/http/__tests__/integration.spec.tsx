/* eslint-disable ts/no-explicit-any, style/jsx-one-expression-per-line */
import type { KeyValue as HttpKeyValue, HttpNodeType } from '../types'
import type { PanelProps } from '@/types/workflow'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import ApiInput from '../components/api-input'
import AuthorizationModal from '../components/authorization'
import RadioGroup from '../components/authorization/radio-group'
import EditBody from '../components/edit-body'
import KeyValue from '../components/key-value'
import BulkEdit from '../components/key-value/bulk-edit'
import KeyValueEdit from '../components/key-value/key-value-edit'
import InputItem from '../components/key-value/key-value-edit/input-item'
import KeyValueItem from '../components/key-value/key-value-edit/item'
import Timeout from '../components/timeout'
import Node from '../node'
import Panel from '../panel'
import { AuthorizationType, BodyType, Method } from '../types'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: vi.fn((_nodeId: string, options?: any) => ({
    availableVars: [
      { variable: ['node-1', 'token'], type: VarType.string },
      { variable: ['node-1', 'upload'], type: VarType.file },
    ].filter(varPayload => options?.filterVar ? options.filterVar(varPayload) : true),
    availableNodes: [],
    availableNodesWithParent: [],
  })),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({ value, onChange, placeholder, className, readOnly, onFocusChange }: any) => (
    <input
      value={value}
      placeholder={placeholder}
      className={className}
      readOnly={readOnly}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
      onChange={event => onChange(event.target.value)}
    />
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/field', () => ({
  default: ({ title, operations, children }: any) => <div><div>{title}</div><div>{operations}</div>{children}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  default: ({ children }: any) => <div>{children}</div>,
  VarItem: ({ name, type }: any) => <div>{name}:{type}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/split', () => ({
  default: () => <div>split</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: ({ onChange, filterVar, onRemove }: any) => (
    <div>
      <div>{`file-filter:${String(filterVar?.({ type: VarType.file }))}:${String(filterVar?.({ type: VarType.string }))}`}</div>
      <button type="button" onClick={() => onChange(['node-1', 'file'])}>pick-file</button>
      {onRemove && <button type="button" onClick={onRemove}>remove-file</button>}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/prompt/editor', () => ({
  default: ({ value, onChange, title }: any) => (
    <div>
      <div>{typeof title === 'string' ? title : 'editor'}</div>
      <input value={value} onChange={event => onChange(event.target.value)} />
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/text-editor', () => ({
  default: ({ value, onChange, onBlur, headerRight }: any) => (
    <div>
      {headerRight}
      <textarea value={value} onChange={event => onChange(event.target.value)} onBlur={onBlur} />
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  default: ({ value }: any) => <div>{value}</div>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/selector', () => ({
  default: ({ options, onChange, trigger }: any) => (
    <div>
      {trigger}
      {options.map((option: any) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('../components/curl-panel', () => ({
  default: () => <div>curl-panel</div>,
}))

vi.mock('../use-config', () => ({
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

const mockUseConfig = vi.mocked(useConfig)
const mockUseStore = vi.mocked(useStore)

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

const keyValueItem: HttpKeyValue = {
  id: 'kv-1',
  key: 'name',
  value: 'alice',
  type: 'text',
}

const createConfigResult = (overrides: Partial<ReturnType<typeof useConfig>> = {}): ReturnType<typeof useConfig> => ({
  readOnly: false,
  isDataReady: true,
  inputs: createData(),
  handleVarListChange: vi.fn(),
  handleAddVariable: vi.fn(),
  filterVar: vi.fn(() => true),
  handleMethodChange: vi.fn(),
  handleUrlChange: vi.fn(),
  headers: [keyValueItem],
  setHeaders: vi.fn(),
  addHeader: vi.fn(),
  isHeaderKeyValueEdit: false,
  toggleIsHeaderKeyValueEdit: vi.fn(),
  params: [keyValueItem],
  setParams: vi.fn(),
  addParam: vi.fn(),
  isParamKeyValueEdit: false,
  toggleIsParamKeyValueEdit: vi.fn(),
  setBody: vi.fn(),
  handleSSLVerifyChange: vi.fn(),
  isShowAuthorization: true,
  showAuthorization: vi.fn(),
  hideAuthorization: vi.fn(),
  setAuthorization: vi.fn(),
  setTimeout: vi.fn(),
  isShowCurlPanel: true,
  showCurlPanel: vi.fn(),
  hideCurlPanel: vi.fn(),
  handleCurlImport: vi.fn(),
  ...overrides,
})

const panelProps: PanelProps = {
  getInputVars: vi.fn(() => []),
  toVarInputs: vi.fn(() => []),
  runInputData: {},
  runInputDataRef: { current: {} },
  setRunInputData: vi.fn(),
  runResult: null,
}

const renderPanel = (data: HttpNodeType = createData()) => (
  render(<Panel id="node-1" data={data} panelProps={panelProps} />)
)

describe('http path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseStore.mockReturnValue({
      HttpRequest: {
        timeout: {
          max_connect_timeout: 10,
          max_read_timeout: 600,
          max_write_timeout: 600,
        },
      },
    } as any)
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  // The HTTP path should expose auth, request editing, key-value tables, timeout, and request preview behavior.
  describe('Path Integration', () => {
    it('should switch radio-group options', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <RadioGroup
          options={[
            { value: 'none', label: 'None' },
            { value: 'apiKey', label: 'API Key' },
          ]}
          value="none"
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('API Key'))
      expect(onChange).toHaveBeenCalledWith('apiKey')
    })

    it('should edit authorization settings and save them', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onHide = vi.fn()
      render(
        <AuthorizationModal
          nodeId="node-1"
          payload={{ type: 'apiKey', config: { type: 'custom', header: 'X-Key', api_key: 'secret' } } as any}
          onChange={onChange}
          isShow
          onHide={onHide}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.http.authorization.api-key'))
      await user.click(screen.getByText('workflow.nodes.http.authorization.custom'))
      fireEvent.change(screen.getByDisplayValue('secret'), { target: { value: 'updated-secret' } })
      await user.click(screen.getByText('common.operation.save'))

      expect(onChange).toHaveBeenCalled()
      expect(onHide).toHaveBeenCalled()
    })

    it('should bootstrap api key config when auth starts without config', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <AuthorizationModal
          nodeId="node-1"
          payload={{ type: 'none' as any }}
          onChange={onChange}
          isShow
          onHide={vi.fn()}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.http.authorization.api-key'))
      await user.click(screen.getByText('common.operation.save'))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        type: 'api-key',
        config: expect.objectContaining({
          type: 'basic',
          api_key: '',
        }),
      }))
    })

    it('should create custom header auth config and apply focus styles to the api key input', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <AuthorizationModal
          nodeId="node-1"
          payload={{ type: 'api-key' as any }}
          onChange={onChange}
          isShow
          onHide={vi.fn()}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.http.authorization.custom'))

      const inputs = screen.getAllByRole('textbox')
      fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: 'X-Token' } })
      fireEvent.focus(inputs[1] as HTMLInputElement)
      expect(inputs[1])!.toHaveClass('border-components-input-border-active')
      fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: 'secret-token' } })
      fireEvent.blur(inputs[1] as HTMLInputElement)
      await user.click(screen.getByText('common.operation.save'))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        type: 'api-key',
        config: expect.objectContaining({
          type: 'custom',
          header: 'X-Token',
          api_key: 'secret-token',
        }),
      }))
    })

    it('should update method and url from the api input', async () => {
      const user = userEvent.setup()
      const onMethodChange = vi.fn()
      const onUrlChange = vi.fn()
      render(
        <ApiInput
          nodeId="node-1"
          readonly={false}
          method={'GET' as any}
          onMethodChange={onMethodChange}
          url="https://api.example.com"
          onUrlChange={onUrlChange}
        />,
      )

      await user.click(screen.getByText('POST'))
      fireEvent.change(screen.getByDisplayValue('https://api.example.com'), { target: { value: 'https://api.changed.com' } })

      expect(onMethodChange).toHaveBeenCalled()
      expect(onUrlChange).toHaveBeenCalledWith('https://api.changed.com')
    })

    it('should hide the method dropdown icon and use an empty placeholder in readonly mode', () => {
      const { container } = render(
        <ApiInput
          nodeId="node-1"
          readonly
          method={'GET' as any}
          onMethodChange={vi.fn()}
          url="https://api.example.com"
          onUrlChange={vi.fn()}
        />,
      )

      expect(container.querySelector('svg')).toBeNull()
      expect(screen.getByDisplayValue('https://api.example.com'))!.toHaveAttribute('placeholder', '')
    })

    it('should update focus styling for editable inputs and show the remove action again on blur-sm', () => {
      const onChange = vi.fn()
      const onRemove = vi.fn()
      const { container, rerender } = render(
        <InputItem
          nodeId="node-1"
          value="alice"
          onChange={onChange}
          hasRemove
          onRemove={onRemove}
        />,
      )

      const input = screen.getByDisplayValue('alice')
      fireEvent.focus(input)
      expect(input)!.toHaveClass('bg-components-input-bg-active')
      expect(container.querySelector('button')).toBeNull()
      fireEvent.blur(input)
      expect(container.querySelector('button')).not.toBeNull()

      rerender(
        <InputItem
          nodeId="node-1"
          value=""
          onChange={onChange}
          hasRemove={false}
          placeholder="missing-value"
          readOnly
        />,
      )

      expect(screen.getByText('missing-value'))!.toBeInTheDocument()
    })

    it('should clamp timeout values and propagate changes', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Timeout
          readonly={false}
          nodeId="node-1"
          payload={{ connect: 5, read: 10, write: 15 }}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.http.timeout.title'))
      fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '999' } })

      expect(onChange).toHaveBeenCalled()
    })

    it('should clear timeout values to undefined and clamp low values to the minimum', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Timeout
          readonly={false}
          nodeId="node-1"
          payload={{ connect: 5, read: 10, write: 15 }}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('workflow.nodes.http.timeout.title'))
      fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '' } })
      fireEvent.change(screen.getByDisplayValue('15'), { target: { value: '0' } })

      expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({ read: undefined }))
      expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({ write: 1 }))
    })

    it('should delegate key-value list editing and bulk editing actions', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onAdd = vi.fn()

      render(
        <div>
          <KeyValue
            readonly={false}
            nodeId="node-1"
            list={[keyValueItem]}
            onChange={onChange}
            onAdd={onAdd}
          />
          <BulkEdit
            value="name:alice"
            onChange={onChange}
            onSwitchToKeyValueEdit={onAdd}
          />
        </div>,
      )

      fireEvent.change(screen.getAllByDisplayValue('name:alice')[0]!, { target: { value: 'name:bob' } })
      fireEvent.blur(screen.getAllByDisplayValue('name:bob')[0]!)
      await user.click(screen.getByText('workflow.nodes.http.keyValueEdit'))

      expect(onChange).toHaveBeenCalled()
      expect(onAdd).toHaveBeenCalled()
    })

    it('should return null when key-value edit receives a non-array list', () => {
      const { container } = render(
        <KeyValueEdit
          readonly={false}
          nodeId="node-1"
          list={'invalid' as any}
          onChange={vi.fn()}
          onAdd={vi.fn()}
        />,
      )

      expect(container)!.toBeEmptyDOMElement()
    })

    it('should edit standalone input items and key-value rows', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onRemove = vi.fn()
      const onAdd = vi.fn()
      render(
        <div>
          <InputItem
            nodeId="node-1"
            value="alice"
            onChange={onChange}
            hasRemove
            onRemove={onRemove}
          />
          <KeyValueItem
            instanceId="kv-1"
            nodeId="node-1"
            readonly={false}
            canRemove
            payload={keyValueItem}
            onChange={onChange}
            onRemove={onRemove}
            isLastItem
            onAdd={onAdd}
            isSupportFile
          />
          <KeyValueEdit
            readonly={false}
            nodeId="node-1"
            list={[keyValueItem]}
            onChange={onChange}
            onAdd={onAdd}
          />
        </div>,
      )

      fireEvent.change(screen.getAllByDisplayValue('alice')[0]!, { target: { value: 'bob' } })
      await user.click(screen.getAllByRole('combobox', { name: 'workflow.nodes.http.type' })[0]!)
      await user.click(screen.getByRole('option', { name: /file/i }))

      expect(onChange).toHaveBeenCalled()
    })

    it('should only append a new key-value row after the last value field receives content', () => {
      const onChange = vi.fn()
      const onRemove = vi.fn()
      const onAdd = vi.fn()
      render(
        <KeyValueItem
          instanceId="kv-append"
          nodeId="node-1"
          readonly={false}
          canRemove
          payload={{ id: 'kv-append', key: 'name', value: '', type: 'text' } as any}
          onChange={onChange}
          onRemove={onRemove}
          isLastItem
          onAdd={onAdd}
        />,
      )

      const valueInput = screen.getAllByPlaceholderText('workflow.nodes.http.insertVarPlaceholder')[1]!

      fireEvent.click(valueInput)
      expect(onAdd).not.toHaveBeenCalled()

      fireEvent.change(valueInput, { target: { value: 'alice' } })
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: 'alice' }))
      expect(onAdd).toHaveBeenCalledTimes(1)
    })

    it('should edit key-only rows and select file payload rows', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const onRemove = vi.fn()
      render(
        <KeyValueItem
          instanceId="kv-2"
          nodeId="node-1"
          readonly={false}
          canRemove
          payload={{ id: 'kv-2', key: 'attachment', value: '', type: 'file', file: [] } as any}
          onChange={onChange}
          onRemove={onRemove}
          isLastItem={false}
          onAdd={vi.fn()}
          isSupportFile
          keyNotSupportVar
        />,
      )

      fireEvent.change(screen.getByDisplayValue('attachment'), { target: { value: 'upload' } })
      expect(screen.getByText('file-filter:true:false'))!.toBeInTheDocument()
      await user.click(screen.getByText('pick-file'))
      await user.click(screen.getByText('remove-file'))

      expect(onChange).toHaveBeenCalled()
      expect(onRemove).toHaveBeenCalled()
    })

    it('should show the full file-type menu and update the row type selection', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <KeyValueItem
          instanceId="kv-type"
          nodeId="node-1"
          readonly={false}
          canRemove
          payload={{ id: 'kv-type', key: 'attachment', value: '', type: 'text' } as any}
          onChange={onChange}
          onRemove={vi.fn()}
          isLastItem={false}
          onAdd={vi.fn()}
          isSupportFile
        />,
      )

      await user.click(screen.getByRole('combobox', { name: 'workflow.nodes.http.type' }))

      const fileOption = screen.getByRole('option', { name: /file/i })
      expect(screen.getByRole('option', { name: /text/i }))!.toBeInTheDocument()
      expect(fileOption.closest('.h-7')).toBeNull()

      await user.click(fileOption)

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: 'file' }))
    })

    it('should update the raw-text body payload', () => {
      const onChange = vi.fn()
      render(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'raw-text', data: [{ id: 'body-1', type: 'text', value: 'hello' }] } as any}
          onChange={onChange}
        />,
      )

      fireEvent.change(screen.getByDisplayValue('hello'), { target: { value: 'updated-body' } })

      expect(onChange).toHaveBeenCalled()
    })

    it('should initialize an empty json body and support legacy string payload rendering', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'json', data: [] } as any}
          onChange={onChange}
        />,
      )

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"a":1}' } })

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        type: 'json',
        data: [expect.objectContaining({ value: '{"a":1}' })],
      }))

      rerender(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'json', data: 'legacy' } as any}
          onChange={onChange}
        />,
      )

      expect(screen.getByRole('textbox'))!.toHaveValue('')
    })

    it('should switch to key-value body types and propagate key-value edits', () => {
      const onChange = vi.fn()
      render(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'none', data: [] } as any}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getByRole('radio', { name: 'form-data' }))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        type: 'form-data',
        data: [expect.objectContaining({ key: '', value: '' })],
      }))

      onChange.mockClear()

      render(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'form-data', data: [{ id: 'body-1', type: 'text', key: 'name', value: 'alice' }] } as any}
          onChange={onChange}
        />,
      )

      fireEvent.click(screen.getAllByDisplayValue('alice')[0]!)
      fireEvent.change(screen.getAllByDisplayValue('alice')[0]!, { target: { value: 'bob' } })

      expect(onChange.mock.calls.some(([payload]) => Array.isArray(payload.data) && payload.data.length === 2)).toBe(true)
      expect(onChange.mock.calls.some(([payload]) => Array.isArray(payload.data) && payload.data[0]?.value === 'bob')).toBe(true)
    })

    it('should render the binary body picker and forward file selections', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'binary', data: [{ id: 'body-1', type: 'file', file: [] }] } as any}
          onChange={onChange}
        />,
      )

      await user.click(screen.getByText('pick-file'))

      expect(onChange).toHaveBeenCalled()
    })

    it('should initialize an empty binary body before saving the selected file', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <EditBody
          readonly={false}
          nodeId="node-1"
          payload={{ type: 'binary', data: [] } as any}
          onChange={onChange}
        />,
      )

      expect(screen.getByText('file-filter:true:false'))!.toBeInTheDocument()
      await user.click(screen.getByText('pick-file'))

      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        type: 'binary',
        data: [expect.objectContaining({
          type: 'file',
          file: ['node-1', 'file'],
        })],
      }))
    })

    it('should render the request node preview when a url exists', () => {
      renderWorkflowFlowComponent(
        <Node
          id="node-1"
          data={createData()}
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.getByText(Method.get))!.toBeInTheDocument()
      expect(screen.getByText('https://api.example.com'))!.toBeInTheDocument()
    })

    it('should render nothing when the request url is empty', () => {
      renderWorkflowFlowComponent(
        <Node
          id="node-1"
          data={createData({ url: '' })}
        />,
        { nodes: [], edges: [] },
      )

      expect(screen.queryByText(Method.get)).not.toBeInTheDocument()
      expect(screen.queryByText('https://api.example.com')).not.toBeInTheDocument()
    })

    it('should render the panel sections and output vars', async () => {
      renderPanel()

      expect(screen.getByText('body:string'))!.toBeInTheDocument()
      expect(screen.getByText('status_code:number'))!.toBeInTheDocument()
      expect(screen.getByText('headers:object'))!.toBeInTheDocument()
      expect(screen.getByText('files:Array[File]'))!.toBeInTheDocument()
      expect(screen.getAllByText('workflow.nodes.http.authorization.authorization').length).toBeGreaterThan(0)
      expect(screen.getByText('workflow.nodes.http.curl.title'))!.toBeInTheDocument()
      expect(screen.getByText('curl-panel'))!.toBeInTheDocument()
    })

    it('should hide modal overlays when the panel is readonly', () => {
      mockUseConfig.mockReturnValueOnce(createConfigResult({
        readOnly: true,
      }))

      renderPanel()

      expect(screen.queryByText('curl-panel')).not.toBeInTheDocument()
      expect(screen.queryByText('workflow.nodes.http.authorization.api-key-title')).not.toBeInTheDocument()
    })
  })
})
