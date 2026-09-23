import {
  getDefaultMetricDescription,
  getDefaultMetricDescriptionI18nKey,
} from '../default-metric-descriptions'

describe('default metric descriptions', () => {
  it('resolves kebab-case metric ids', () => {
    expect(getDefaultMetricDescription('context-precision')).toContain(
      'retrieval pipeline returns little noise',
    )
    expect(getDefaultMetricDescription('answer-correctness')).toContain(
      'factual accuracy and completeness',
    )
  })

  it('normalizes snake-case backend metric ids', () => {
    expect(getDefaultMetricDescription('CONTEXT_RECALL')).toContain(
      'does not miss important supporting evidence',
    )
    expect(getDefaultMetricDescription('TOOL_CALL_ACCURACY')).toContain(
      'selects and invokes the expected tools',
    )
  })

  it('resolves the matching i18n key', () => {
    expect(getDefaultMetricDescriptionI18nKey('ANSWER_RELEVANCY')).toBe(
      'metrics.builtin.description.answerRelevancy',
    )
    expect(getDefaultMetricDescriptionI18nKey('argument-correctness')).toBe(
      'metrics.builtin.description.argumentCorrectness',
    )
  })
})
