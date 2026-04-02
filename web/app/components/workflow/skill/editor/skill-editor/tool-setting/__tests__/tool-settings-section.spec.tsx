import { fireEvent, render, screen } from '@testing-library/react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import ToolSettingsSection from '../tool-settings-section'

const mocks = vi.hoisted(() => ({
  formProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/base/divider', () => ({
  default: () => <div data-testid="divider" />,
}))

vi.mock('@/app/components/plugins/plugin-detail-panel/tool-selector/reasoning-config-form', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.formProps.push(props)
    const variable = (props.schemas as Array<{ variable: string }>)[0]?.variable ?? 'unknown'
    return (
      <button
        type="button"
        data-testid={`reasoning-form-${variable}`}
        onClick={() => (props.onChange as (value: Record<string, unknown>) => void)({
          [variable]: {
            auto: 0,
            value: {
              type: 'constant',
              value: 'updated',
            },
          },
        })}
      >
        {variable}
      </button>
    )
  },
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolParametersToFormSchemas: (params: Array<{ name: string, type: string, default?: unknown }>) => {
    return params.map(param => ({
      variable: param.name,
      type: param.type,
      default: param.default,
    }))
  },
}))

beforeEach(() => {
  mocks.formProps.length = 0
})

describe('ToolSettingsSection', () => {
  it('should return null when the provider is not team-authorized or when there are no schemas', () => {
    const { rerender, container } = render(
      <ToolSettingsSection
        currentProvider={{ is_team_authorization: false } as never}
        currentTool={{
          parameters: [{ name: 'temperature', form: 'basic', type: FormTypeEnum.textInput }],
        } as never}
      />,
    )

    expect(container).toBeEmptyDOMElement()

    rerender(
      <ToolSettingsSection
        currentProvider={{ is_team_authorization: true } as never}
        currentTool={{ parameters: [] } as never}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('should build safe config values and merge settings and params changes', () => {
    const onChange = vi.fn()

    render(
      <ToolSettingsSection
        currentProvider={{ is_team_authorization: true } as never}
        currentTool={{
          parameters: [
            { name: 'model', form: 'basic', type: FormTypeEnum.modelSelector, default: 'gpt-4.1' },
            { name: 'attachment', form: 'llm', type: FormTypeEnum.file, default: null },
          ],
        } as never}
        value={{
          provider_id: 'provider-1',
          tool_name: 'tool-1',
          settings: {},
          parameters: {},
        } as never}
        enableVariableReference
        nodesOutputVars={[]}
        availableNodes={[]}
        onChange={onChange}
      />,
    )

    expect(screen.getByTestId('divider')).toBeInTheDocument()
    expect(screen.getByText('detailPanel.toolSelector.reasoningConfig')).toBeInTheDocument()
    expect(mocks.formProps).toHaveLength(2)
    expect(mocks.formProps[0]).toMatchObject({
      nodeId: 'workflow',
      disableVariableReference: false,
      value: {
        model: {
          auto: 0,
          value: {
            type: VarKindType.constant,
            value: 'gpt-4.1',
          },
        },
      },
    })
    expect(mocks.formProps[1]).toMatchObject({
      nodeId: 'workflow',
      disableVariableReference: false,
      value: {
        attachment: {
          auto: 1,
          value: {
            type: VarKindType.variable,
            value: null,
          },
        },
      },
    })

    fireEvent.click(screen.getByTestId('reasoning-form-model'))
    fireEvent.click(screen.getByTestId('reasoning-form-attachment'))

    expect(onChange).toHaveBeenNthCalledWith(1, expect.objectContaining({
      settings: {
        model: {
          auto: 0,
          value: {
            type: 'constant',
            value: 'updated',
          },
        },
      },
    }))
    expect(onChange).toHaveBeenNthCalledWith(2, expect.objectContaining({
      parameters: {
        attachment: {
          auto: 0,
          value: {
            type: 'constant',
            value: 'updated',
          },
        },
      },
    }))
  })
})
