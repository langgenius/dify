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
    expect(getDefaultMetricDescription('TOOL_SELECTION_CORRECTNESS')).toContain(
      'exact tools available at runtime',
    )
    expect(getDefaultMetricDescription('TOOL_ARGUMENT_CORRECTNESS')).toContain(
      'model-controlled tool arguments',
    )
    expect(getDefaultMetricDescription('TRAJECTORY_QUALITY')).toContain('observable execution path')
  })

  it('resolves the matching i18n key', () => {
    expect(getDefaultMetricDescriptionI18nKey('ANSWER_RELEVANCY')).toBe(
      'metrics.builtin.description.answerRelevancy',
    )
    expect(getDefaultMetricDescriptionI18nKey('argument-correctness')).toBe(
      'metrics.builtin.description.argumentCorrectness',
    )
    expect(getDefaultMetricDescriptionI18nKey('task_completion')).toBe(
      'metrics.builtin.description.taskCompletion',
    )
  })
})
