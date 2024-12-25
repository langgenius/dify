import type { FC } from 'react'
import type { NodePanelProps } from '../../types'
import type { AgentNodeType } from './types'
import Field from '../_base/components/field'
import { InputNumber } from '@/app/components/base/input-number'
import Slider from '@/app/components/base/slider'
import { AgentStrategy } from '../_base/components/agent-strategy'
import useConfig from './use-config'
import { useTranslation } from 'react-i18next'

const mockSchema = [
  {
    name: 'format',
    label: {
      en_US: 'Format',
      zh_Hans: '格式',
      pt_BR: 'Format',
      ja_JP: 'Format',
    },
    placeholder: null,
    scope: null,
    required: false,
    default: '%Y-%m-%d %H:%M:%S',
    min: null,
    max: null,
    options: [],
    type: 'text-input',
    human_description: {
      en_US: 'Time format in strftime standard.',
      zh_Hans: 'strftime 标准的时间格式。',
      pt_BR: 'Time format in strftime standard.',
      ja_JP: 'Time format in strftime standard.',
    },
    form: 'form',
    llm_description: null,
    variable: 'format',
    _type: 'string',
    show_on: [],
    tooltip: {
      en_US: 'Time format in strftime standard.',
      zh_Hans: 'strftime 标准的时间格式。',
      pt_BR: 'Time format in strftime standard.',
      ja_JP: 'Time format in strftime standard.',
    },
  },
  {
    name: 'timezone',
    label: {
      en_US: 'Timezone',
      zh_Hans: '时区',
      pt_BR: 'Timezone',
      ja_JP: 'Timezone',
    },
    placeholder: null,
    scope: null,
    required: false,
    default: 'UTC',
    min: null,
    max: null,
    options: [
      {
        value: 'UTC',
        label: {
          en_US: 'UTC',
          zh_Hans: 'UTC',
          pt_BR: 'UTC',
          ja_JP: 'UTC',
        },
        show_on: [],
      },
      {
        value: 'America/New_York',
        label: {
          en_US: 'America/New_York',
          zh_Hans: '美洲/纽约',
          pt_BR: 'America/New_York',
          ja_JP: 'America/New_York',
        },
        show_on: [],
      },
      {
        value: 'America/Los_Angeles',
        label: {
          en_US: 'America/Los_Angeles',
          zh_Hans: '美洲/洛杉矶',
          pt_BR: 'America/Los_Angeles',
          ja_JP: 'America/Los_Angeles',
        },
        show_on: [],
      },
      {
        value: 'America/Chicago',
        label: {
          en_US: 'America/Chicago',
          zh_Hans: '美洲/芝加哥',
          pt_BR: 'America/Chicago',
          ja_JP: 'America/Chicago',
        },
        show_on: [],
      },
      {
        value: 'America/Sao_Paulo',
        label: {
          en_US: 'America/Sao_Paulo',
          zh_Hans: '美洲/圣保罗',
          pt_BR: 'América/São Paulo',
          ja_JP: 'America/Sao_Paulo',
        },
        show_on: [],
      },
      {
        value: 'Asia/Shanghai',
        label: {
          en_US: 'Asia/Shanghai',
          zh_Hans: '亚洲/上海',
          pt_BR: 'Asia/Shanghai',
          ja_JP: 'Asia/Shanghai',
        },
        show_on: [],
      },
      {
        value: 'Asia/Ho_Chi_Minh',
        label: {
          en_US: 'Asia/Ho_Chi_Minh',
          zh_Hans: '亚洲/胡志明市',
          pt_BR: 'Ásia/Ho Chi Minh',
          ja_JP: 'Asia/Ho_Chi_Minh',
        },
        show_on: [],
      },
      {
        value: 'Asia/Tokyo',
        label: {
          en_US: 'Asia/Tokyo',
          zh_Hans: '亚洲/东京',
          pt_BR: 'Asia/Tokyo',
          ja_JP: 'Asia/Tokyo',
        },
        show_on: [],
      },
      {
        value: 'Asia/Dubai',
        label: {
          en_US: 'Asia/Dubai',
          zh_Hans: '亚洲/迪拜',
          pt_BR: 'Asia/Dubai',
          ja_JP: 'Asia/Dubai',
        },
        show_on: [],
      },
      {
        value: 'Asia/Kolkata',
        label: {
          en_US: 'Asia/Kolkata',
          zh_Hans: '亚洲/加尔各答',
          pt_BR: 'Asia/Kolkata',
          ja_JP: 'Asia/Kolkata',
        },
        show_on: [],
      },
      {
        value: 'Asia/Seoul',
        label: {
          en_US: 'Asia/Seoul',
          zh_Hans: '亚洲/首尔',
          pt_BR: 'Asia/Seoul',
          ja_JP: 'Asia/Seoul',
        },
        show_on: [],
      },
      {
        value: 'Asia/Singapore',
        label: {
          en_US: 'Asia/Singapore',
          zh_Hans: '亚洲/新加坡',
          pt_BR: 'Asia/Singapore',
          ja_JP: 'Asia/Singapore',
        },
        show_on: [],
      },
      {
        value: 'Europe/London',
        label: {
          en_US: 'Europe/London',
          zh_Hans: '欧洲/伦敦',
          pt_BR: 'Europe/London',
          ja_JP: 'Europe/London',
        },
        show_on: [],
      },
      {
        value: 'Europe/Berlin',
        label: {
          en_US: 'Europe/Berlin',
          zh_Hans: '欧洲/柏林',
          pt_BR: 'Europe/Berlin',
          ja_JP: 'Europe/Berlin',
        },
        show_on: [],
      },
      {
        value: 'Europe/Moscow',
        label: {
          en_US: 'Europe/Moscow',
          zh_Hans: '欧洲/莫斯科',
          pt_BR: 'Europe/Moscow',
          ja_JP: 'Europe/Moscow',
        },
        show_on: [],
      },
      {
        value: 'Australia/Sydney',
        label: {
          en_US: 'Australia/Sydney',
          zh_Hans: '澳大利亚/悉尼',
          pt_BR: 'Australia/Sydney',
          ja_JP: 'Australia/Sydney',
        },
        show_on: [],
      },
      {
        value: 'Pacific/Auckland',
        label: {
          en_US: 'Pacific/Auckland',
          zh_Hans: '太平洋/奥克兰',
          pt_BR: 'Pacific/Auckland',
          ja_JP: 'Pacific/Auckland',
        },
        show_on: [],
      },
      {
        value: 'Africa/Cairo',
        label: {
          en_US: 'Africa/Cairo',
          zh_Hans: '非洲/开罗',
          pt_BR: 'Africa/Cairo',
          ja_JP: 'Africa/Cairo',
        },
        show_on: [],
      },
    ],
    type: 'select',
    human_description: {
      en_US: 'Timezone',
      zh_Hans: '时区',
      pt_BR: 'Timezone',
      ja_JP: 'Timezone',
    },
    form: 'form',
    llm_description: null,
    variable: 'timezone',
    _type: 'select',
    show_on: [],
    tooltip: {
      en_US: 'Timezone',
      zh_Hans: '时区',
      pt_BR: 'Timezone',
      ja_JP: 'Timezone',
    },
  },
] as const

const AgentPanel: FC<NodePanelProps<AgentNodeType>> = (props) => {
  const { inputs, setInputs } = useConfig(props.id, props.data)
  const { t } = useTranslation()
  const [iter, setIter] = [inputs.max_iterations, (value: number) => {
    setInputs({
      ...inputs,
      max_iterations: value,
    })
  }]
  return <div className='space-y-2 my-2'>
    <Field title={t('workflow.nodes.agent.strategy.label')} className='px-4' >
      <AgentStrategy
        strategy={inputs.agent_strategy_name ? {
          agent_strategy_provider_name: inputs.agent_strategy_provider_name!,
          agent_strategy_name: inputs.agent_strategy_name!,
          agent_parameters: inputs.agent_parameters,
        } : undefined}
        onStrategyChange={(strategy) => {
          setInputs({
            ...inputs,
            agent_strategy_provider_name: strategy?.agent_strategy_provider_name,
            agent_strategy_name: strategy?.agent_strategy_name,
            agent_parameters: strategy?.agent_parameters,
          })
        }}
        formSchema={mockSchema as any}
        formValue={inputs.agent_parameters || {}}
        onFormValueChange={value => setInputs({
          ...inputs,
          agent_parameters: value,
        })}
      />
    </Field>
    <Field title={t('workflow.nodes.agent.tools')} className='px-4'>

    </Field>
    <Field title={t('workflow.nodes.agent.maxIterations')} tooltip={'max iter'} inline className='px-4'>
      <div className='flex w-[200px] items-center gap-3'>
        <Slider value={iter} onChange={setIter} className='w-full' min={1} max={10} />
        <InputNumber
          value={iter}
          // TODO: maybe empty, handle this
          onChange={setIter as any}
          defaultValue={3}
          size='sm'
          min={1}
          max={10}
          className='w-12'
          placeholder=''
        />
      </div>
    </Field>
  </div>
}

export default AgentPanel
