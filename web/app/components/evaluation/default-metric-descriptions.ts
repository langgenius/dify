import type { TFunction } from 'i18next'

const DEFAULT_METRIC_DESCRIPTION = {
  FAITHFULNESS:
    "Measures whether every claim in the model's response is grounded in the provided retrieved context. A high score means the answer contains no hallucinated content; each statement can be traced back to a passage in the context.",
  ANSWER_RELEVANCY:
    "Measures how well the model's response addresses the user's question. A high score means the answer stays on-topic; a low score indicates irrelevant content or a failure to answer the actual question.",
  ANSWER_CORRECTNESS:
    "Measures the factual accuracy and completeness of the model's answer relative to a ground-truth reference. It combines semantic similarity with key-fact coverage, so both meaning and content matter.",
  SEMANTIC_SIMILARITY:
    "Measures the cosine similarity between the model's response and the reference answer in an embedding space. It evaluates whether the two texts convey the same meaning, independent of factual correctness.",
  CONTEXT_PRECISION:
    'Measures the proportion of retrieved context chunks that are actually relevant to the question (precision). A high score means the retrieval pipeline returns little noise.',
  CONTEXT_RECALL:
    'Measures the proportion of ground-truth information that is covered by the retrieved context chunks (recall). A high score means the retrieval pipeline does not miss important supporting evidence.',
  CONTEXT_RELEVANCE:
    'Measures how relevant each individual retrieved chunk is to the query. Similar to CONTEXT_PRECISION but evaluated at the chunk level rather than against a reference answer.',
  ARGUMENT_CORRECTNESS:
    'Measures whether an agent supplies the expected arguments when invoking a tool.',
  TOOL_CALL_ACCURACY: 'Measures whether an agent selects and invokes the expected tools.',
} as const

type DefaultMetricDescription =
  (typeof DEFAULT_METRIC_DESCRIPTION)[keyof typeof DEFAULT_METRIC_DESCRIPTION]

const DEFAULT_METRIC_DESCRIPTION_KEYS = {
  FAITHFULNESS: 'metrics.builtin.description.faithfulness',
  ANSWER_RELEVANCY: 'metrics.builtin.description.answerRelevancy',
  ANSWER_CORRECTNESS: 'metrics.builtin.description.answerCorrectness',
  SEMANTIC_SIMILARITY: 'metrics.builtin.description.semanticSimilarity',
  CONTEXT_PRECISION: 'metrics.builtin.description.contextPrecision',
  CONTEXT_RECALL: 'metrics.builtin.description.contextRecall',
  CONTEXT_RELEVANCE: 'metrics.builtin.description.contextRelevance',
  ARGUMENT_CORRECTNESS: 'metrics.builtin.description.argumentCorrectness',
  TOOL_CALL_ACCURACY: 'metrics.builtin.description.toolCallAccuracy',
} as const

type DefaultMetricDescriptionKey =
  (typeof DEFAULT_METRIC_DESCRIPTION_KEYS)[keyof typeof DEFAULT_METRIC_DESCRIPTION_KEYS]

const DEFAULT_METRIC_DESCRIPTIONS: Record<string, DefaultMetricDescription> = {
  faithfulness: DEFAULT_METRIC_DESCRIPTION.FAITHFULNESS,
  'answer-relevancy': DEFAULT_METRIC_DESCRIPTION.ANSWER_RELEVANCY,
  'answer-correctness': DEFAULT_METRIC_DESCRIPTION.ANSWER_CORRECTNESS,
  'semantic-similarity': DEFAULT_METRIC_DESCRIPTION.SEMANTIC_SIMILARITY,
  'context-precision': DEFAULT_METRIC_DESCRIPTION.CONTEXT_PRECISION,
  'context-recall': DEFAULT_METRIC_DESCRIPTION.CONTEXT_RECALL,
  'context-relevance': DEFAULT_METRIC_DESCRIPTION.CONTEXT_RELEVANCE,
  'argument-correctness': DEFAULT_METRIC_DESCRIPTION.ARGUMENT_CORRECTNESS,
  'tool-call-accuracy': DEFAULT_METRIC_DESCRIPTION.TOOL_CALL_ACCURACY,
  relevance: DEFAULT_METRIC_DESCRIPTION.ANSWER_RELEVANCY,
}

const DEFAULT_METRIC_DESCRIPTION_I18N_KEYS: Record<string, DefaultMetricDescriptionKey> = {
  faithfulness: DEFAULT_METRIC_DESCRIPTION_KEYS.FAITHFULNESS,
  'answer-relevancy': DEFAULT_METRIC_DESCRIPTION_KEYS.ANSWER_RELEVANCY,
  'answer-correctness': DEFAULT_METRIC_DESCRIPTION_KEYS.ANSWER_CORRECTNESS,
  'semantic-similarity': DEFAULT_METRIC_DESCRIPTION_KEYS.SEMANTIC_SIMILARITY,
  'context-precision': DEFAULT_METRIC_DESCRIPTION_KEYS.CONTEXT_PRECISION,
  'context-recall': DEFAULT_METRIC_DESCRIPTION_KEYS.CONTEXT_RECALL,
  'context-relevance': DEFAULT_METRIC_DESCRIPTION_KEYS.CONTEXT_RELEVANCE,
  'argument-correctness': DEFAULT_METRIC_DESCRIPTION_KEYS.ARGUMENT_CORRECTNESS,
  'tool-call-accuracy': DEFAULT_METRIC_DESCRIPTION_KEYS.TOOL_CALL_ACCURACY,
  relevance: DEFAULT_METRIC_DESCRIPTION_KEYS.ANSWER_RELEVANCY,
}

const normalizeMetricId = (metricId: string) => metricId.trim().toLowerCase().replace(/_/g, '-')

export const getDefaultMetricDescription = (metricId: string) => {
  return DEFAULT_METRIC_DESCRIPTIONS[normalizeMetricId(metricId)] ?? ''
}

export const getDefaultMetricDescriptionI18nKey = (metricId: string) => {
  return DEFAULT_METRIC_DESCRIPTION_I18N_KEYS[normalizeMetricId(metricId)] ?? null
}

export const getTranslatedMetricDescription = (
  t: TFunction,
  metricId: string,
  fallbackDescription = '',
) => {
  const defaultDescription = fallbackDescription || getDefaultMetricDescription(metricId)
  const descriptionI18nKey = getDefaultMetricDescriptionI18nKey(metricId)

  if (!descriptionI18nKey) return defaultDescription

  return t(
    descriptionI18nKey as never,
    { defaultValue: defaultDescription } as never,
  ) as unknown as string
}
