import { getDuplicateNodeTitles } from '../duplicate-node-titles'

it('finds shared visible titles only across distinct published nodes', () => {
  expect(
    getDuplicateNodeTitles([
      { node_id: 'llm-1', type: 'llm', title: 'Answer' },
      { node_id: 'llm-1', type: 'llm', title: 'Answer' },
      { node_id: 'llm-2', type: 'llm', title: ' Answer ' },
      { node_id: 'llm-3', type: 'llm', title: 'Summarize' },
    ]),
  ).toEqual(['Answer'])
})

it('allows a published version without metric-capable nodes', () => {
  expect(getDuplicateNodeTitles([])).toEqual([])
})
