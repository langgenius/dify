import { getDefaultMetricDescription, getDefaultMetricDescriptionI18nKey, getTranslatedMetricDescription } from '../default-metric-descriptions'

describe('default metric descriptions', () => {
  it('should resolve descriptions for kebab-case metric ids', () => {
    expect(getDefaultMetricDescription('context-precision')).toContain('retrieval pipeline returns little noise')
    expect(getDefaultMetricDescription('answer-correctness')).toContain('factual accuracy and completeness')
  })

  it('should normalize snake_case metric ids from backend payloads', () => {
    expect(getDefaultMetricDescription('CONTEXT_RECALL')).toContain('does not miss important supporting evidence')
    expect(getDefaultMetricDescription('TOOL_CORRECTNESS')).toContain('tool-use strategy matches the expected behavior')
  })

  it('should support the legacy relevance alias', () => {
    expect(getDefaultMetricDescription('relevance')).toContain('addresses the user\'s question')
  })

  it('should resolve i18n keys for builtin metrics', () => {
    expect(getDefaultMetricDescriptionI18nKey('context-precision')).toBe('metrics.builtin.description.contextPrecision')
    expect(getDefaultMetricDescriptionI18nKey('ANSWER_RELEVANCY')).toBe('metrics.builtin.description.answerRelevancy')
  })

  it('should use translated content when translation key exists', () => {
    const t = vi.fn((key: string, options?: { defaultValue?: string }) => {
      if (key === 'metrics.builtin.description.faithfulness')
        return '忠实性中文文案'

      return options?.defaultValue ?? key
    })

    expect(getTranslatedMetricDescription(t as never, 'faithfulness')).toBe('忠实性中文文案')
    expect(getTranslatedMetricDescription(t as never, 'latency', 'Latency fallback')).toBe('Latency fallback')
  })
})
