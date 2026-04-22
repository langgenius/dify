import type { TFunction } from 'i18next'
import type {
  Emoji,
  WorkflowToolProviderOutputParameter,
  WorkflowToolProviderOutputSchema,
  WorkflowToolProviderParameter,
  WorkflowToolProviderRequest,
} from '../types'
import { VarType } from '@/app/components/workflow/types'
import { buildWorkflowOutputParameters } from './utils'

export const RESERVED_WORKFLOW_OUTPUTS: WorkflowToolProviderOutputParameter[] = [
  {
    name: 'text',
    description: '',
    type: VarType.string,
    reserved: true,
  },
  {
    name: 'files',
    description: '',
    type: VarType.arrayFile,
    reserved: true,
  },
  {
    name: 'json',
    description: '',
    type: VarType.arrayObject,
    reserved: true,
  },
]

export const isWorkflowToolNameValid = (name: string) => {
  if (name === '')
    return true

  return /^\w+$/.test(name)
}

export const getReservedWorkflowOutputParameters = (t: TFunction) => {
  return RESERVED_WORKFLOW_OUTPUTS.map(output => ({
    ...output,
    description: output.name === 'text'
      ? t('nodes.tool.outputVars.text', { ns: 'workflow' })
      : output.name === 'files'
        ? t('nodes.tool.outputVars.files.title', { ns: 'workflow' })
        : t('nodes.tool.outputVars.json', { ns: 'workflow' }),
  }))
}

export const hasReservedWorkflowOutputConflict = (
  reservedOutputParameters: WorkflowToolProviderOutputParameter[],
  name: string,
) => {
  return reservedOutputParameters.some(parameter => parameter.name === name)
}

export const getWorkflowOutputParameters = (
  rawOutputParameters: WorkflowToolProviderOutputParameter[],
  outputSchema?: WorkflowToolProviderOutputSchema,
) => {
  return buildWorkflowOutputParameters(rawOutputParameters, outputSchema)
}

export const buildWorkflowToolRequestPayload = ({
  description,
  emoji,
  label,
  labels,
  name,
  parameters,
  privacyPolicy,
}: {
  description: string
  emoji: Emoji
  label: string
  labels: string[]
  name: string
  parameters: WorkflowToolProviderParameter[]
  privacyPolicy: string
}): WorkflowToolProviderRequest & { label: string } => {
  return {
    name,
    description,
    icon: emoji,
    label,
    parameters: parameters.map(item => ({
      name: item.name,
      description: item.description,
      form: item.form,
    })),
    labels,
    privacy_policy: privacyPolicy,
  }
}
