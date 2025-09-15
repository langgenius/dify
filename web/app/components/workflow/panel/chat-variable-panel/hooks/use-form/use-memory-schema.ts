import { FormTypeEnum } from '@/app/components/base/form/types'
import type { FormSchema } from '@/app/components/base/form/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'

export const useMemorySchema = () => {
  return [
    {
      name: 'template',
      label: 'Memory Template',
      type: FormTypeEnum.promptInput,
      tooltip: 'template',
      placeholder: 'Enter template for AI memory (e.g., user profile, preferences, context)...',
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      selfFormProps: {
        withTopDivider: true,
      },
    },
    {
      name: 'instruction',
      label: 'Update Instructions',
      type: FormTypeEnum.promptInput,
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      selfFormProps: {
        enablePromptGenerator: true,
        placeholder: 'How should the AI update this memory...',
      },
    },
    {
      name: 'strategy',
      label: 'Update trigger',
      type: FormTypeEnum.radio,
      default: 'on_turns',
      fieldClassName: 'flex justify-between',
      inputClassName: 'w-[102px]',
      options: [
        {
          label: 'Every N turns',
          value: 'on_turns',
        },
        {
          label: 'Auto',
          value: 'on_auto',
        },
      ],
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      selfFormProps: {
        withTopDivider: true,
      },
    },
    {
      name: 'update_turns',
      label: 'Update every',
      type: FormTypeEnum.textNumber,
      fieldClassName: 'flex justify-between',
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
        {
          variable: 'strategy',
          value: 'on_turns',
        },
      ],
      selfFormProps: {
        withSlider: true,
        sliderMin: 0,
        sliderMax: 1000,
        sliderStep: 50,
        sliderClassName: 'w-[98px]',
        inputWrapperClassName: 'w-[102px]',
      },
    },
    {
      name: 'scope',
      label: 'Scope',
      type: FormTypeEnum.radio,
      default: 'app',
      fieldClassName: 'flex justify-between',
      inputClassName: 'w-[102px]',
      options: [
        {
          label: 'App',
          value: 'app',
        },
        {
          label: 'Node',
          value: 'node',
        },
      ],
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      selfFormProps: {
        withTopDivider: true,
      },
    },
    {
      name: 'node',
      label: 'Node',
      type: FormTypeEnum.nodeSelector,
      fieldClassName: 'flex justify-between',
      inputClassName: 'w-[102px]',
      default: '',
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
        {
          variable: 'scope',
          value: 'node',
        },
      ],
    },
    {
      name: 'term',
      label: 'Term',
      type: FormTypeEnum.radio,
      default: 'session',
      fieldClassName: 'flex justify-between',
      inputClassName: 'w-[102px]',
      options: [
        {
          label: 'Session',
          value: 'session',
        },
        {
          label: 'Persistent',
          value: 'persistent',
        },
      ],
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      selfFormProps: {
        withBottomDivider: true,
      },
    },
    {
      name: 'more',
      label: 'MoreSettings',
      type: FormTypeEnum.collapse,
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
    },
    {
      name: 'model',
      label: 'Memory model',
      type: FormTypeEnum.modelSelector,
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
        {
          variable: 'more',
          value: true,
        },
      ],
    },
    {
      name: 'schedule_mode',
      label: 'Update method',
      type: FormTypeEnum.radio,
      options: [
        {
          label: 'Sync',
          value: 'sync',
        },
        {
          label: 'Async',
          value: 'async',
        },
      ],
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
        {
          variable: 'more',
          value: true,
        },
      ],
    },
    {
      name: 'end_user_editable',
      label: 'Editable in web app',
      type: FormTypeEnum.switch,
      fieldClassName: 'flex justify-between',
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
        {
          variable: 'more',
          value: true,
        },
      ],
    },
  ] as FormSchema[]
}

export const useMemoryDefaultValues = () => {
  return {
    template: '',
    instruction: '',
    strategy: 'on_turns',
    update_turns: 0,
    scope: 'app',
    term: 'session',
    more: false,
    model: '',
    schedule_mode: 'sync',
    end_user_visible: false,
    end_user_editable: false,
  }
}
