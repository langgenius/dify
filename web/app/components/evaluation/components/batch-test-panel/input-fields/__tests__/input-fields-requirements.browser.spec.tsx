import type { InputField } from '../input-fields-utils'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { render } from 'vitest-browser-react'
import evaluation from '@/i18n/locales/en-US/evaluation.json'
import { useEvaluationStore } from '../../../../store'
import InputFieldsRequirements from '../input-fields-requirements'

async function renderRequirements(
  resourceType: 'apps' | 'datasets',
  inputFields: InputField[],
  resourceId = 'target-1',
) {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    resources: { 'en-US': { evaluation } },
    keySeparator: false,
    interpolation: { escapeValue: false },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <InputFieldsRequirements
        resourceType={resourceType}
        resourceId={resourceId}
        inputFields={inputFields}
        isLoading={false}
      />
    </I18nextProvider>,
  )
}

vi.unmock('react-i18next')

it('explains each workflow input and expected result through its named help button', async () => {
  const fields = [
    ['index', evaluation['batch.fieldHelp.index']],
    ['question', evaluation['batch.fieldHelp.input']],
    ['LLM1 : expected_output', evaluation['batch.fieldHelp.expectedOutput']],
    ['Agent : success_criteria', evaluation['batch.fieldHelp.successCriteria']],
    ['Agent : expected_tool_calls', evaluation['batch.fieldHelp.expectedToolCalls']],
  ] as const
  const screen = await renderRequirements(
    'apps',
    fields.map(([name]) => ({ name, type: 'string' })),
  )

  await expect.element(screen.getByText('Data requirements')).toBeVisible()
  for (const [name, description] of fields) {
    await screen.getByRole('button', { name }).click()
    await expect.element(screen.getByRole('dialog', { name })).toHaveTextContent(description)
  }
})

it('uses retrieval reference guidance for dataset and Knowledge Retrieval v2 fields', async () => {
  const dataset = await renderRequirements('datasets', [
    { name: 'expected_output', type: 'string' },
  ])
  await dataset.getByRole('button', { name: 'expected_output' }).click()
  await expect
    .element(dataset.getByRole('dialog', { name: 'expected_output' }))
    .toHaveTextContent(evaluation['batch.fieldHelp.retrievalExpectedOutput'])

  useEvaluationStore.getState().hydrateResource('apps', 'retrieval-app', {
    evaluation_framework: 'ragas',
    default_metrics: [
      {
        metric: 'context_precision',
        node_info_list: [{ node_id: 'kr-1', title: 'Knowledge', type: 'knowledge-retrieval-v2' }],
      },
    ],
  })
  const app = await renderRequirements(
    'apps',
    [{ name: 'Knowledge : expected_output', type: 'string' }],
    'retrieval-app',
  )
  await app.getByRole('button', { name: 'Knowledge : expected_output' }).click()
  await expect
    .element(app.getByRole('dialog', { name: 'Knowledge : expected_output' }))
    .toHaveTextContent(evaluation['batch.fieldHelp.retrievalExpectedOutput'])
})
