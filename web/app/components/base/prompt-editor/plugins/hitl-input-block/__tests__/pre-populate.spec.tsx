import type { i18n as I18nType } from 'i18next'
import type { ReactNode } from 'react'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import PrePopulate from '../pre-populate'

vi.unmock('react-i18next')

let i18n: I18nType

const render = (ui: ReactNode) => {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])

  const start = createStartNode({
    id: 'start',
    data: {
      variables: [
        { variable: 'title', label: 'Title', type: InputVarType.textInput, required: false },
        { variable: 'count', label: 'Count', type: InputVarType.number, required: false },
      ],
    },
  })
  const code = createNode({
    id: 'code',
    data: {
      title: 'Code output',
      type: BlockEnum.Code,
      outputs: {
        payload: {
          type: VarType.object,
          children: [{ variable: 'label', type: VarType.string }],
        },
      },
    },
  })
  const human = createNode({
    id: 'human',
    data: { title: 'Human input', type: BlockEnum.HumanInput },
  })

  return renderWorkflowFlowComponent(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>, {
    queryClient,
    nodes: [start, code, human],
    edges: [
      createEdge({
        source: 'start',
        target: 'code',
        data: { sourceType: BlockEnum.Start, targetType: BlockEnum.Code },
      }),
      createEdge({
        source: 'code',
        target: 'human',
        data: { sourceType: BlockEnum.Code, targetType: BlockEnum.HumanInput },
      }),
    ],
    initialStoreState: {
      environmentVariables: [
        {
          id: 'env-secret',
          name: 'API_KEY',
          value: '[__HIDDEN__]',
          value_type: 'secret',
          description: 'Credential',
        },
      ],
    },
  })
}

describe('PrePopulate', () => {
  beforeAll(async () => {
    i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      defaultNS: 'workflowHumanInput',
      interpolation: { escapeValue: false },
      resources: {
        'en-US': {
          workflowHumanInput: {
            nodes: {
              humanInput: {
                insertInputField: {
                  prePopulateFieldPlaceholder: '<staticContent/> <variable/>',
                  staticContent: 'Static Content',
                  variable: 'Variable',
                  useVarInstead: 'Use Variable Instead',
                  useConstantInstead: 'Use Constant Instead',
                },
              },
            },
          },
        },
      },
    })
  })

  it('keeps Tab navigation native and opens static content on activation', async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Before prepopulation</button>
        <PrePopulate nodeId="human" isVariable={false} value="" />
      </>,
    )

    expect(screen.getByText('Static Content')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Before prepopulation' }))
    await user.keyboard('{Tab}')

    expect(screen.getByRole('button', { name: 'Static Content' })).toHaveFocus()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox', { name: 'Static Content' })).toHaveFocus()
  })

  it('updates the constant value and switches the controlled caller to variable mode', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onIsVariableChange = vi.fn()

    const Wrapper = () => {
      const [value, setValue] = useState('initial value')
      const [isVariable, setIsVariable] = useState(false)
      return (
        <PrePopulate
          nodeId="human"
          isVariable={isVariable}
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
          onIsVariableChange={(next) => {
            onIsVariableChange(next)
            setIsVariable(next)
          }}
          onValueSelectorChange={() => {}}
        />
      )
    }

    render(<Wrapper />)

    await user.clear(screen.getByRole('textbox', { name: 'Static Content' }))
    await user.type(screen.getByRole('textbox', { name: 'Static Content' }), 'next')
    await user.click(screen.getByRole('button', { name: 'Use Variable Instead' }))

    expect(onValueChange).toHaveBeenLastCalledWith('next')
    expect(onIsVariableChange).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('textbox', { name: 'Static Content' })).not.toBeInTheDocument()
  })

  it('selects a supported graph variable and switches the controlled caller to constant mode', async () => {
    const user = userEvent.setup()
    const onValueSelectorChange = vi.fn()
    const onIsVariableChange = vi.fn()

    const Wrapper = () => {
      const [isVariable, setIsVariable] = useState(true)
      const [valueSelector, setValueSelector] = useState<string[]>(['start', 'title'])
      return (
        <PrePopulate
          nodeId="human"
          isVariable={isVariable}
          valueSelector={valueSelector}
          onValueSelectorChange={(next) => {
            onValueSelectorChange(next)
            if (Array.isArray(next)) setValueSelector(next)
          }}
          onIsVariableChange={(next) => {
            onIsVariableChange(next)
            setIsVariable(next)
          }}
          value=""
          onValueChange={() => {}}
        />
      )
    }

    render(<Wrapper />)

    expect(screen.getByText('title')).toBeVisible()
    await user.click(screen.getByText('title'))
    const picker = await screen.findByRole('dialog')
    expect(within(picker).queryByText('payload')).not.toBeInTheDocument()
    expect(within(picker).getByText('API_KEY')).toBeVisible()
    await user.click(within(picker).getByText('count'))

    expect(onValueSelectorChange).toHaveBeenCalledWith(['start', 'count'])
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('count')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Use Constant Instead' }))
    expect(onIsVariableChange).toHaveBeenCalledWith(false)
    expect(screen.getByRole('textbox', { name: 'Static Content' })).toBeInTheDocument()
  })
})
