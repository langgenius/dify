import type { DefaultModel, Model, ModelItem, TypeWithI18N } from '../declarations'
import Fuse from 'fuse.js'
import { supportFunctionCall } from '@/utils/tool-call'
import { ModelFeatureEnum } from '../declarations'

type ProviderSearchEntry = {
  provider: string
  labels: string[]
  providerKeys: string[]
}

type ModelSearchEntry = {
  provider: string
  model: string
  normalizedLabels: string[]
}

type SearchMatches = {
  providers: Set<string>
  models: Set<string>
}

type ModelSelectorSearchIndex = {
  search: (query: string) => SearchMatches
}

type FilterModelSelectorModelsParams = {
  aiCreditVisibleProviders: Set<string>
  defaultModel?: DefaultModel
  inputValue: string
  installedModelList: Model[]
  scopeFeatures: ModelFeatureEnum[]
  searchIndex: ModelSelectorSearchIndex
}

const providerSearchOptions = {
  ignoreDiacritics: true,
  ignoreLocation: true,
  minMatchCharLength: 2,
  shouldSort: false,
  threshold: 0.25,
  keys: [
    { name: 'labels', weight: 2 },
    { name: 'providerKeys', weight: 1 },
  ],
}

const modelSearchOptions = {
  ignoreDiacritics: true,
  shouldSort: false,
  useExtendedSearch: true,
  keys: [
    'normalizedLabels',
  ],
}

const normalizeModelSearchValue = (value: string) => (
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
)

const looksLikeModelQuery = (value: string) => /\d/.test(value)

const getLabelSearchValues = (label: TypeWithI18N, language: string) => {
  if (label[language] !== undefined)
    return [label[language]]

  return Array.from(new Set(Object.values(label)))
}

const getProviderKeySearchValues = (provider: string) => {
  const keys = provider
    .split('/')
    .filter(part => part && part !== 'langgenius')

  return Array.from(new Set([
    ...keys,
    ...keys.map(normalizeModelSearchValue),
  ]))
}

const createModelSearchKey = (provider: string, model: string) => `${provider}/${model}`

const modelSupportsScopeFeatures = (modelItem: ModelItem, scopeFeatures: ModelFeatureEnum[]) => {
  if (scopeFeatures.length === 0)
    return true

  return scopeFeatures.every((feature) => {
    if (feature === ModelFeatureEnum.toolCall)
      return supportFunctionCall(modelItem.features)

    return modelItem.features?.includes(feature) ?? false
  })
}

export const createModelSelectorSearchIndex = (installedModelList: Model[], language: string): ModelSelectorSearchIndex => {
  const providerEntries = installedModelList.map<ProviderSearchEntry>((model) => {
    return {
      provider: model.provider,
      labels: getLabelSearchValues(model.label, language),
      providerKeys: getProviderKeySearchValues(model.provider),
    }
  })
  const modelEntries = installedModelList.flatMap<ModelSearchEntry>(model =>
    model.models.map((modelItem) => {
      const labels = getLabelSearchValues(modelItem.label, language)

      return {
        provider: model.provider,
        model: modelItem.model,
        normalizedLabels: Array.from(new Set([
          modelItem.model,
          ...labels,
        ].map(normalizeModelSearchValue))),
      }
    }),
  )
  const providerFuse = new Fuse(providerEntries, providerSearchOptions)
  const modelFuse = new Fuse(modelEntries, modelSearchOptions)

  return {
    search: (query) => {
      const trimmedQuery = query.trim()

      if (!trimmedQuery)
        return { providers: new Set(), models: new Set() }

      const normalizedQuery = normalizeModelSearchValue(trimmedQuery)
      const providerMatches = looksLikeModelQuery(trimmedQuery)
        ? new Set<string>()
        : new Set(providerFuse.search(trimmedQuery).map(({ item }) => item.provider))
      const modelMatches = normalizedQuery
        ? new Set(
            modelFuse
              .search(`'${normalizedQuery}`)
              .map(({ item }) => createModelSearchKey(item.provider, item.model)),
          )
        : new Set<string>()

      return {
        providers: providerMatches,
        models: modelMatches,
      }
    },
  }
}

export const filterModelSelectorModels = ({
  aiCreditVisibleProviders,
  defaultModel,
  inputValue,
  installedModelList,
  scopeFeatures,
  searchIndex,
}: FilterModelSelectorModelsParams) => {
  const trimmedInputValue = inputValue.trim()
  const matches = trimmedInputValue
    ? searchIndex.search(trimmedInputValue)
    : { providers: new Set<string>(), models: new Set<string>() }

  const filtered = installedModelList.map((model) => {
    const providerMatched = matches.providers.has(model.provider)
    const filteredModels = model.models
      .filter((modelItem) => {
        if (!trimmedInputValue || providerMatched)
          return true

        return matches.models.has(createModelSearchKey(model.provider, modelItem.model))
      })
      .filter(modelItem => modelSupportsScopeFeatures(modelItem, scopeFeatures))

    if (
      (trimmedInputValue && filteredModels.length === 0)
      || (!trimmedInputValue && filteredModels.length === 0 && !aiCreditVisibleProviders.has(model.provider))
    ) {
      return null
    }

    return { ...model, models: filteredModels }
  }).filter((model): model is Model => model !== null)

  if (defaultModel?.provider) {
    filtered.sort((a, b) => {
      const aSelected = a.provider === defaultModel.provider ? 0 : 1
      const bSelected = b.provider === defaultModel.provider ? 0 : 1

      return aSelected - bSelected
    })
  }

  return filtered
}
