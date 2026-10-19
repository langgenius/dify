import { act, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { changeLanguage } from '@/i18n/client'
import english from '@/i18n/locales/en-US/workflow-integrations.json'
import chinese from '@/i18n/locales/zh-Hans/workflow-integrations.json'
import { VarType } from '../../../../types'
import { ComparisonOperator } from '../../../if-else/types'
import FilterCondition from '../filter-condition'

vi.unmock('react-i18next')

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [] }),
}))

// The editor consumes the translated placeholder; its variable editing is tested separately.
vi.mock('@/app/components/workflow/nodes/_base/components/input-support-select-var', () => ({
  default: ({ placeholder }: { placeholder: string }) => <input placeholder={placeholder} />,
}))
vi.mock('../../../if-else/components/condition-list/condition-operator', () => ({
  default: () => null,
}))

it('loads the filter placeholder on first mount and updates it when the language changes', async () => {
  render(
    <I18nClientProvider locale="en-US" resource={{}}>
      <Suspense fallback={<span>Loading filter</span>}>
        <FilterCondition
          condition={{ key: 'name', comparison_operator: ComparisonOperator.equal, value: '' }}
          varType={VarType.file}
          onChange={() => {}}
          hasSubVariable={false}
          readOnly={false}
          nodeId="node-1"
        />
      </Suspense>
    </I18nClientProvider>,
  )

  expect(
    await screen.findByPlaceholderText(english['nodes.http.insertVarPlaceholder']),
  ).toBeVisible()
  await act(() => changeLanguage('zh-Hans'))
  expect(
    await screen.findByPlaceholderText(chinese['nodes.http.insertVarPlaceholder']),
  ).toBeVisible()
})
