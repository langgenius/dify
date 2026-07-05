import type { EnvVarInput, Pagination } from '@dify/contracts/enterprise/types.gen'
import type { GuideMethod } from './types'
import type { EnvVarBindingSlot, EnvVarValueSelection } from '@/features/deployments/shared/components/env-var-bindings'
import { EnvVarValueSource as ApiEnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { isDeploymentDslImportEnabled } from '@/features/deployments/shared/domain/feature-flags'

export const DEPLOYMENT_PAGE_SIZE = 100
export const SOURCE_APPS_PAGE_SIZE = 100

export function getNextPageParamFromPagination(pagination?: Pagination) {
  const currentPage = pagination?.currentPage ?? 1
  const totalPages = pagination?.totalPages ?? 1

  return currentPage < totalPages ? currentPage + 1 : undefined
}

export function deploymentGuideMethod(method: GuideMethod): GuideMethod {
  return method === 'importDsl' && !isDeploymentDslImportEnabled
    ? 'bindApp'
    : method
}

const RANDOM_SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz'
const RANDOM_SUFFIX_LENGTH = 4
const RANDOM_SUFFIX_FALLBACK_LENGTH = 6
const RANDOM_SUFFIX_MAX_ATTEMPTS = 16

function randomLetterCombination(length: number) {
  const randomValues = new Uint8Array(length)

  if (globalThis.crypto) {
    globalThis.crypto.getRandomValues(randomValues)
  }
  else {
    randomValues.forEach((_, index) => {
      randomValues[index] = Math.floor(Math.random() * 256)
    })
  }

  return Array.from(randomValues, value => RANDOM_SUFFIX_ALPHABET[value % RANDOM_SUFFIX_ALPHABET.length]).join('')
}

export function availableInstanceName(sourceName: string, existingNameSet: Set<string>) {
  if (!existingNameSet.has(sourceName))
    return sourceName

  for (let attempt = 0; attempt < RANDOM_SUFFIX_MAX_ATTEMPTS; attempt++) {
    const candidate = `${sourceName}-${randomLetterCombination(RANDOM_SUFFIX_LENGTH)}`
    if (!existingNameSet.has(candidate))
      return candidate
  }

  return `${sourceName}-${randomLetterCombination(RANDOM_SUFFIX_FALLBACK_LENGTH)}`
}

function envVarValueSource(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined) {
  return selection?.valueSource
    ?? (slot.hasDefaultValue
      ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT
      : slot.hasLastValue
        ? ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT
        : ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL)
}

export function envVarSelectionReady(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined) {
  const valueSource = envVarValueSource(slot, selection)

  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT)
    return Boolean(slot.hasLastValue)
  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT)
    return Boolean(slot.hasDefaultValue)
  if (!selection?.value)
    return false

  return slot.valueType !== 'number' || !Number.isNaN(Number(selection.value))
}

export function envVarInput(slot: EnvVarBindingSlot, selection: EnvVarValueSelection | undefined): EnvVarInput[] {
  const valueSource = envVarValueSource(slot, selection)

  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_LAST_DEPLOYMENT) {
    return slot.hasLastValue
      ? [{ key: slot.key, valueSource }]
      : []
  }

  if (valueSource === ApiEnvVarValueSource.ENV_VAR_VALUE_SOURCE_DSL_DEFAULT) {
    return slot.hasDefaultValue
      ? [{ key: slot.key, valueSource }]
      : []
  }

  if (!selection?.value || (slot.valueType === 'number' && Number.isNaN(Number(selection.value))))
    return []

  return [{
    key: slot.key,
    value: selection.value,
    valueSource,
  }]
}
