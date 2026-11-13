import type { HumanInputFormDefinition, LegacyHumanInputFormData } from '../types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType } from '@/app/components/workflow/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import LoadedFormContent from '../loaded-form-content'
import { normalizeLegacyHumanInputForm } from '../normalize-legacy-definition'

// Load the real code-split renderer before assertions start their interaction deadlines.
beforeAll(async () => {
  await import('@/app/components/base/markdown/streamdown-wrapper')
})

describe('LoadedFormContent', () => {
  const inputs: HumanInputFormDefinition['inputs'] = [
    {
      type: InputVarType.paragraph,
      output_variable_name: 'response',
      default: {
        type: 'constant',
        value: 'initial response',
        selector: [],
      },
    },
  ]
  const actions: HumanInputFormDefinition['actions'] = [
    {
      id: 'approve',
      title: 'Approve',
      button_style: UserActionButtonType.Primary,
    },
  ]
  const legacyData: LegacyHumanInputFormData = {
    site: {
      site: {
        title: 'Legacy app',
        icon_type: 'emoji',
        icon: 'L',
        icon_background: '#fff',
        icon_url: '',
      },
    },
    form_content: '{{#$output.response#}}',
    inputs,
    resolved_default_values: {},
    user_actions: actions,
    expiration_time: 1_900_000_000,
  }
  const v2Definition: HumanInputFormDefinition = {
    formContent: '{{#$output.response#}}',
    inputs,
    resolvedDefaultValues: {},
    actions,
    expirationTime: 1_900_000_000,
  }

  it.each([
    ['legacy', normalizeLegacyHumanInputForm(legacyData)],
    ['v2', v2Definition],
  ] as const)(
    'renders and processes the version-neutral %s definition',
    async (_version, definition) => {
      const onSubmit = vi.fn()

      await render(
        <LoadedFormContent definition={definition} isSubmitting={false} onSubmit={onSubmit} />,
      )
      const response = page.getByRole('textbox', { name: 'response' })
      await expect.element(response).toHaveValue('initial response')
      await response.clear()
      await response.fill('updated response')
      await page.getByRole('button', { name: 'Approve' }).click()

      expect(onSubmit).toHaveBeenCalledWith({ response: 'updated response' }, 'approve')
      await expect.element(page.getByText('share.chat.poweredBy')).toBeInTheDocument()
    },
  )

  it('blocks repeated submissions until the pending action resolves', async () => {
    let finishSubmission: (() => void) | undefined
    const submission = new Promise<void>((resolve) => {
      finishSubmission = resolve
    })
    const onSubmit = vi.fn().mockReturnValue(submission)

    await render(
      <LoadedFormContent definition={v2Definition} isSubmitting={false} onSubmit={onSubmit} />,
    )
    const approve = page.getByRole('button', { name: 'Approve' })
    await approve.click()

    await expect.element(approve).toHaveAttribute('aria-disabled', 'true')
    await expect.element(approve).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)

    finishSubmission?.()
    await submission
    await expect.element(approve).toBeEnabled()
  })

  it('requires nonblank text and a selected option before submitting their values', async () => {
    const onSubmit = vi.fn()
    const definition: HumanInputFormDefinition = {
      ...v2Definition,
      formContent: '{{#$output.response#}}\n\n{{#$output.reviewer#}}',
      resolvedDefaultValues: { response: '   ' },
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'response',
          default: { type: 'constant', value: '   ', selector: [] },
        },
        {
          type: InputVarType.select,
          output_variable_name: 'reviewer',
          option_source: { type: 'constant', selector: [], value: ['Alice', 'Bob'] },
        },
      ],
    }

    await render(
      <LoadedFormContent definition={definition} isSubmitting={false} onSubmit={onSubmit} />,
    )
    const approve = page.getByRole('button', { name: 'Approve' })
    await expect.element(approve).toBeEnabled()
    await approve.click()
    expect(onSubmit).not.toHaveBeenCalled()
    await expect.element(page.getByText(/fieldRequired/).nth(1)).toBeVisible()

    const response = page.getByRole('textbox', { name: 'response' })
    await response.clear()
    await response.fill('Ready for review')
    await expect.element(approve).toBeEnabled()

    await page.getByRole('combobox', { name: 'reviewer' }).click()
    await page.getByRole('option', { name: 'Bob' }).click()
    await expect.element(approve).toBeEnabled()
    await approve.click()
    expect(onSubmit).toHaveBeenCalledWith(
      { response: 'Ready for review', reviewer: 'Bob' },
      'approve',
    )
  })

  it('retains entered values and exposes a safe error when workflow submission rejects', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('internal transport details'))
      .mockResolvedValue(undefined)
    await render(
      <LoadedFormContent definition={v2Definition} isSubmitting={false} onSubmit={onSubmit} />,
    )
    const response = page.getByRole('textbox', { name: 'response' })
    await response.clear()
    await response.fill('Keep this draft')
    await page.getByRole('button', { name: 'Approve' }).click()
    await expect.element(page.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
    await expect.element(page.getByText('internal transport details')).not.toBeInTheDocument()
    await expect.element(response).toHaveValue('Keep this draft')
    await page.getByRole('button', { name: 'Approve' }).click()
    expect(onSubmit).toHaveBeenLastCalledWith({ response: 'Keep this draft' }, 'approve')
  })

  it('gives repeated placeholders distinct label associations while retaining a shared wire value', async () => {
    const onSubmit = vi.fn()
    await render(
      <LoadedFormContent
        definition={{
          ...v2Definition,
          formContent:
            'First review\n\n{{#$output.response#}}\n\nSecond review\n\n{{#$output.response#}}',
        }}
        isSubmitting={false}
        onSubmit={onSubmit}
      />,
    )
    const first = page.getByRole('textbox', { name: 'First review' })
    const second = page.getByRole('textbox', { name: 'Second review' })
    await first.click()
    await userEvent.tab()
    await expect.element(second).toHaveFocus()
    await second.clear()
    await second.fill('One shared response')
    await expect.element(first).toHaveValue('One shared response')
    await page.getByRole('button', { name: 'Approve' }).click()
    expect(onSubmit).toHaveBeenCalledWith({ response: 'One shared response' }, 'approve')
  })

  it('preserves Markdown content alongside the editable fields', async () => {
    const definition: HumanInputFormDefinition = {
      ...v2Definition,
      formContent: [
        '# Review request',
        'Read the **summary** and [reference](https://example.com/reference). Use `status`.',
        '3. First review\n4. Final review',
        '| Field | Value |\n| --- | --- |\n| Owner | Alice |',
        '![Seasonal landscape](/logo/logo-site.png)',
        '{{#$output.response#}}',
      ].join('\n\n'),
    }

    await render(
      <LoadedFormContent definition={definition} isSubmitting={false} onSubmit={vi.fn()} />,
    )

    await expect
      .element(page.getByRole('heading', { level: 1, name: 'Review request' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: 'reference' }))
      .toHaveAttribute('href', 'https://example.com/reference')
    await expect.element(page.getByText('summary')).toBeVisible()
    await expect.element(page.getByText('status')).toBeVisible()
    const list = page.getByRole('list')
    await expect.element(list).toHaveAttribute('start', '3')
    await expect.element(list.getByRole('listitem').nth(1)).toHaveTextContent('Final review')
    await expect
      .element(page.getByRole('table').getByRole('cell', { name: 'Alice' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('img', { name: 'Seasonal landscape' }))
      .toHaveAttribute('src', '/logo/logo-site.png')
    await expect
      .element(page.getByRole('textbox', { name: 'response' }))
      .toHaveValue('initial response')
  })

  it('updates optional branding when the definition changes', async () => {
    const view = await render(
      <LoadedFormContent
        definition={normalizeLegacyHumanInputForm(legacyData)}
        isSubmitting={false}
        onSubmit={vi.fn()}
      />,
    )
    await expect.element(page.getByRole('heading', { name: 'Legacy app' })).toBeInTheDocument()
    await view.rerender(
      <LoadedFormContent definition={v2Definition} isSubmitting={false} onSubmit={vi.fn()} />,
    )
    await expect.element(page.getByRole('heading', { name: 'Legacy app' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('img', { name: 'Dify', exact: true })).toBeInTheDocument()
  })
})

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})
