import { useTranslation } from 'react-i18next'
import { FormTypeEnum } from '@/app/components/base/form/types'
import type { FormSchema } from '@/app/components/base/form/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'

export const useMemorySchema = (nodeScopeMemoryVariable?: { nodeId: string }) => {
  const { t } = useTranslation()

  const scopeSchema = [
    {
      name: 'scope',
      label: t('workflow.chatVariable.modal.scope'),
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
      name: 'node_id',
      label: 'Node',
      type: FormTypeEnum.nodeSelector,
      fieldClassName: 'flex justify-between',
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
  ]

  return [
    {
      name: 'template',
      label: t('workflow.chatVariable.modal.memoryTemplate'),
      type: FormTypeEnum.promptInput,
      tooltip: 'template',
      placeholder: t('workflow.chatVariable.modal.memoryTemplatePlaceholder'),
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
      label: t('workflow.chatVariable.modal.updateInstructions'),
      type: FormTypeEnum.promptInput,
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      selfFormProps: {
        enablePromptGenerator: true,
        placeholder: t('workflow.chatVariable.modal.updateInstructionsPlaceholder'),
      },
    },
    {
      name: 'strategy',
      label: t('workflow.chatVariable.modal.updateTrigger'),
      type: FormTypeEnum.radio,
      default: 'on_turns',
      fieldClassName: 'flex justify-between',
      inputClassName: 'w-[102px]',
      options: [
        {
          label: t('workflow.chatVariable.modal.everyNTurns'),
          value: 'on_turns',
        },
        {
          label: t('workflow.chatVariable.modal.auto'),
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
      label: t('workflow.chatVariable.modal.updateEvery'),
      type: FormTypeEnum.textNumber,
      fieldClassName: 'flex justify-between',
      required: true,
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
    ...(!nodeScopeMemoryVariable ? scopeSchema : []),
    {
      name: 'term',
      label: t('workflow.chatVariable.modal.term'),
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
      label: t('workflow.chatVariable.modal.moreSettings'),
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
      label: t('workflow.chatVariable.modal.memoryModel'),
      type: FormTypeEnum.modelSelector,
      required: true,
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      more_on: [
        {
          variable: 'more',
          value: true,
        },
      ],
    },
    {
      name: 'schedule_mode',
      label: t('workflow.chatVariable.modal.updateMethod'),
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
      ],
      more_on: [
        {
          variable: 'more',
          value: true,
        },
      ],
    },
    {
      name: 'end_user_editable',
      label: t('workflow.chatVariable.modal.editableInWebApp'),
      type: FormTypeEnum.switch,
      fieldClassName: 'flex justify-between',
      show_on: [
        {
          variable: 'value_type',
          value: [ChatVarType.Memory],
        },
      ],
      more_on: [
        {
          variable: 'more',
          value: true,
        },
      ],
    },
  ] as FormSchema[]
}

export const useMemoryDefaultValues = (nodeScopeMemoryVariable?: { nodeId: string }) => {
  return {
    template: '',
    instruction: '',
    strategy: 'on_turns',
    update_turns: 500,
    preserved_turns: 10,
    scope: nodeScopeMemoryVariable ? 'node' : 'app',
    node_id: nodeScopeMemoryVariable?.nodeId || '',
    term: 'session',
    more: false,
    model: '',
    schedule_mode: 'sync',
    end_user_visible: false,
    end_user_editable: false,
  }
}
