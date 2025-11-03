import type { FormValue, ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'

export const mergeValidCompletionParams = (
  oldParams: FormValue | undefined,
  rules: ModelParameterRule[],
  isAdvancedMode: boolean = false,
): { params: FormValue; removedDetails: Record<string, string> } => {
  if (!oldParams || Object.keys(oldParams).length === 0)
    return { params: {}, removedDetails: {} }

  const ruleMap: Record<string, ModelParameterRule> = {}
  rules.forEach((r) => {
    ruleMap[r.name] = r
  })

  const nextParams: FormValue = {}
  const removedDetails: Record<string, string> = {}

  Object.entries(oldParams).forEach(([key, value]) => {
    if (key === 'stop' && isAdvancedMode) {
      // keep stop in advanced mode
      nextParams[key] = value
      return
    }
    const rule = ruleMap[key]
    if (!rule) {
      removedDetails[key] = 'unsupported'
      return
    }

    switch (rule.type) {
      case 'int':
      case 'float': {
        if (typeof value !== 'number') {
          removedDetails[key] = 'invalid type'
          return
        }
        const min = rule.min ?? Number.NEGATIVE_INFINITY
        const max = rule.max ?? Number.POSITIVE_INFINITY
        if (value < min || value > max) {
          removedDetails[key] = `out of range (${min}-${max})`
          return
        }
        nextParams[key] = value
        return
      }
      case 'boolean': {
        if (typeof value !== 'boolean') {
          removedDetails[key] = 'invalid type'
          return
        }
        nextParams[key] = value
        return
      }
      case 'string':
      case 'text': {
        if (typeof value !== 'string') {
          removedDetails[key] = 'invalid type'
          return
        }
        if (Array.isArray(rule.options) && rule.options.length) {
          if (!(rule.options as string[]).includes(value)) {
            removedDetails[key] = 'unsupported option'
            return
          }
        }
        nextParams[key] = value
        return
      }
      default: {
        removedDetails[key] = `unsupported rule type: ${(rule as any)?.type ?? 'unknown'}`
      }
    }
  })

  return { params: nextParams, removedDetails }
}

export const fetchAndMergeValidCompletionParams = async (
  provider: string,
  modelId: string,
  oldParams: FormValue | undefined,
  isAdvancedMode: boolean = false,
): Promise<{ params: FormValue; removedDetails: Record<string, string> }> => {
  const { fetchModelParameterRules } = await import('@/service/common')
  const url = `/workspaces/current/model-providers/${provider}/models/parameter-rules?model=${modelId}`
  const { data: parameterRules } = await fetchModelParameterRules(url)
  return mergeValidCompletionParams(oldParams, parameterRules ?? [], isAdvancedMode)
}
