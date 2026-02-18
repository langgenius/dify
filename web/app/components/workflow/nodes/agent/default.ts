import type { NodeDefault } from '../../types'
import type { AgentNodeType } from './types'
import type { StrategyDetail, StrategyPluginDetail } from '@/app/components/plugins/types'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderI18nObject } from '@/i18n-config'
import { BlockEnum } from '../../types'
import { genNodeMetaData } from '../../utils'

const metaData = genNodeMetaData({
  sort: 3,
  type: BlockEnum.Agent,
})

const nodeDefault: NodeDefault<AgentNodeType> = {
  metaData,
  defaultValue: {
    tool_node_version: '2',
  },
  checkValid(payload, t, moreDataForCheckValid: {
    strategyProvider?: StrategyPluginDetail
    strategy?: StrategyDetail
    language: string
    isReadyForCheckValid: boolean
  }) {
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
        errorMessage: t('nodes.agent.checkList.strategyNotSelected', { ns: 'workflow' }),
      }
    }
    for (const param of strategy.parameters) {
      // single tool
      if (param.required && param.type === FormTypeEnum.toolSelector) {
        // no value
        const toolValue = payload.agent_parameters?.[param.name]?.value
        if (!toolValue) {
          return {
            isValid: false,
            errorMessage: t('errorMsg.fieldRequired', { ns: 'workflow', field: renderI18nObject(param.label, language) }),
          }
        }
        // not enabled
        else if (!toolValue.enabled) {
          return {
            isValid: false,
            errorMessage: t('errorMsg.noValidTool', { ns: 'workflow', field: renderI18nObject(param.label, language) }),
          }
        }
        // check form of tool
        else {
          const schemas = toolValue.schemas || []
          const userSettings = toolValue.settings
          const reasoningConfig = toolValue.parameters
          const version = payload.version
          const toolNodeVersion = payload.tool_node_version
          const mergeVersion = version || toolNodeVersion
          schemas.forEach((schema: any) => {
            if (schema?.required) {
              if (schema.form === 'form' && !mergeVersion && !userSettings[schema.name]?.value) {
                return {
                  isValid: false,
                  errorMessage: t('errorMsg.toolParameterRequired', { ns: 'workflow', field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                }
              }
              if (schema.form === 'form' && mergeVersion && !userSettings[schema.name]?.value.value) {
                return {
                  isValid: false,
                  errorMessage: t('errorMsg.toolParameterRequired', { ns: 'workflow', field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                }
              }
              if (schema.form === 'llm' && !mergeVersion && reasoningConfig[schema.name].auto === 0 && !reasoningConfig[schema.name]?.value) {
                return {
                  isValid: false,
                  errorMessage: t('errorMsg.toolParameterRequired', { ns: 'workflow', field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                }
              }
              if (schema.form === 'llm' && mergeVersion && reasoningConfig[schema.name].auto === 0 && !reasoningConfig[schema.name]?.value.value) {
                return {
                  isValid: false,
                  errorMessage: t('errorMsg.toolParameterRequired', { ns: 'workflow', field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                }
              }
            }
          })
        }
      }
      // multiple tools
      if (param.required && param.type === FormTypeEnum.multiToolSelector) {
        const tools = payload.agent_parameters?.[param.name]?.value || []
        // no value
        if (!tools.length) {
          return {
            isValid: false,
            errorMessage: t('errorMsg.fieldRequired', { ns: 'workflow', field: renderI18nObject(param.label, language) }),
          }
        }
        // not enabled
        else if (tools.every((tool: any) => !tool.enabled)) {
          return {
            isValid: false,
            errorMessage: t('errorMsg.noValidTool', { ns: 'workflow', field: renderI18nObject(param.label, language) }),
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
                    errorMessage: t('errorMsg.toolParameterRequired', { ns: 'workflow', field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                  }
                }
                if (schema.form === 'llm' && reasoningConfig[schema.name]?.auto === 0 && !reasoningConfig[schema.name]?.value) {
                  return {
                    isValid: false,
                    errorMessage: t('errorMsg.toolParameterRequired', { ns: 'workflow', field: renderI18nObject(param.label, language), param: renderI18nObject(schema.label, language) }),
                  }
                }
              }
            })
          }
          return validState
        }
      }
      // common params
      if (param.required && !(payload.agent_parameters?.[param.name]?.value || param.default)) {
        return {
          isValid: false,
          errorMessage: t('errorMsg.fieldRequired', { ns: 'workflow', field: renderI18nObject(param.label, language) }),
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
