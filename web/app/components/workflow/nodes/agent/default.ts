import type {
  AgentProviderResponse,
  AgentStrategyEntity,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { TFunction } from 'i18next'
import type { NodeDefault } from '../../types'
import type { AgentNodeType } from './types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderI18nObject } from '@/i18n/metadata'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

const metaData = genNodeMetaData({
  sort: 3,
  type: BlockEnum.Agent,
  helpLinkUri: 'agent#classic-agent',
})

const nodeDefault: NodeDefault<AgentNodeType> = {
  metaData,
  defaultValue: {
    tool_node_version: '2',
  },
  checkValid(
    payload,
    t: TFunction<['workflow']>,
    moreDataForCheckValid: {
      strategyProvider?: AgentProviderResponse
      strategy?: AgentStrategyEntity
      language: string
      isReadyForCheckValid: boolean
    },
  ) {
    const { strategy, language, isReadyForCheckValid } = moreDataForCheckValid
    if (!isReadyForCheckValid) {
      return {
        isValid: true,
        errorMessage: '',
      }
    }
    if (!strategy) {
      return {
        isValid: false,
        errorMessage: t(($) => $['nodes.agent.checkList.strategyNotSelected'], { ns: 'workflow' }),
      }
    }
    for (const param of strategy.parameters ?? []) {
      // multiple tools
      if (param.required && param.type === FormTypeEnum.multiToolSelector) {
        const tools = payload.agent_parameters?.[param.name]?.value || []
        // no value
        if (!tools.length) {
          return {
            isValid: false,
            errorMessage: t(($) => $['errorMsg.fieldRequired'], {
              ns: 'workflow',
              field: renderI18nObject(param.label, language),
            }),
          }
        }
        // not enabled
        else if (tools.every((tool: any) => !tool.enabled)) {
          return {
            isValid: false,
            errorMessage: t(($) => $['errorMsg.noValidTool'], {
              ns: 'workflow',
              field: renderI18nObject(param.label, language),
            }),
          }
        }
        // check form of tools
        else {
          const validState = {
            isValid: true,
            errorMessage: '',
          }
          for (const tool of tools) {
            const schemas = tool.schemas || []
            const userSettings = tool.settings
            const reasoningConfig = tool.parameters
            schemas.forEach((schema: any) => {
              if (schema?.required) {
                if (schema.form === 'form' && !userSettings[schema.name]?.value) {
                  return {
                    isValid: false,
                    errorMessage: t(($) => $['errorMsg.toolParameterRequired'], {
                      ns: 'workflow',
                      field: renderI18nObject(param.label, language),
                      param: renderI18nObject(schema.label, language),
                    }),
                  }
                }
                if (
                  schema.form === 'llm' &&
                  reasoningConfig[schema.name]?.auto === 0 &&
                  !reasoningConfig[schema.name]?.value
                ) {
                  return {
                    isValid: false,
                    errorMessage: t(($) => $['errorMsg.toolParameterRequired'], {
                      ns: 'workflow',
                      field: renderI18nObject(param.label, language),
                      param: renderI18nObject(schema.label, language),
                    }),
                  }
                }
              }
            })
          }
          return validState
        }
      }
      // common params
      const savedValue = payload.agent_parameters?.[param.name]?.value
      const value =
        savedValue === undefined || savedValue === null || savedValue === ''
          ? param.default
          : savedValue
      if (param.required && (value === undefined || value === null || value === '')) {
        return {
          isValid: false,
          errorMessage: t(($) => $['errorMsg.fieldRequired'], {
            ns: 'workflow',
            field: renderI18nObject(param.label, language),
          }),
        }
      }
    }
    return {
      isValid: true,
      errorMessage: '',
    }
  },
}

export default nodeDefault
