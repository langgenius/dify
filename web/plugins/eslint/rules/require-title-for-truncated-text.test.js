import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import tsParser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import { it } from 'vitest'
import rule from './require-title-for-truncated-text.js'

const plugin = {
  rules: {
    'require-title-for-truncated-text': rule,
  },
}

function verifyAndFix(code, filename = 'test.tsx') {
  const linter = new Linter()
  return linter.verifyAndFix(
    code,
    [
      {
        files: ['**/*.tsx'],
        languageOptions: {
          parser: tsParser,
          parserOptions: {
            ecmaFeatures: { jsx: true },
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
        },
        plugins: { dify: plugin },
        rules: { 'dify/require-title-for-truncated-text': 'error' },
      },
    ],
    { filename },
  )
}

it('accepts an explicit title and line-clamp-none', () => {
  const result = verifyAndFix(`
    const name = 'Dify'
    export const Example = () => <>
      <span className="truncate" title={name}>{name}</span>
      <span className="line-clamp-none">{name}</span>
    </>
  `)

  assert.equal(result.messages.length, 0)
  assert.equal(result.fixed, false)
})

it('accepts Dify UI TooltipTrigger children and render elements', () => {
  const result = verifyAndFix(`
    import { TooltipTrigger as Trigger } from '@langgenius/dify-ui/tooltip'
    const name = 'Dify'
    export const Example = () => <>
      <Trigger><span className="truncate">{name}</span></Trigger>
      <Trigger render={<span className="line-clamp-2">{name}</span>} />
    </>
  `)

  assert.equal(result.messages.length, 0)
  assert.equal(result.fixed, false)
})

it('adds title for static classes, class helpers, constants, and inline styles', () => {
  const result = verifyAndFix(`
    const truncatedClassName = cn('min-w-0', condition && 'md:truncate')
    export const Example = ({ item, label }) => <>
      <span className={truncatedClassName}>{item.name}</span>
      <p className={cn('line-clamp-2', condition && 'text-secondary')}>{label}</p>
      <div style={{ textOverflow: 'ellipsis' }}>Description</div>
    </>
  `)

  assert.equal(result.messages.length, 0)
  assert.equal(result.fixed, true)
  assert.match(result.output, /className=\{truncatedClassName\} title=\{item\.name\}/u)
  assert.match(result.output, /className=\{cn\([^)]+\)\} title=\{label\}/u)
  assert.match(result.output, /style=\{\{ textOverflow: 'ellipsis' \}\} title="Description"/u)
})

it('replaces an empty title', () => {
  const result = verifyAndFix(`
    export const Example = ({ name }) => <span className="truncate" title="">{name}</span>
  `)

  assert.equal(result.messages.length, 0)
  assert.equal(result.fixed, true)
  assert.match(result.output, /title=\{name\}/u)
})

it('fixes calls and custom components when their visible text is explicit', () => {
  const result = verifyAndFix(`
    export const Example = ({ name }) => <>
      <span className="truncate">{translate(name)}</span>
      <CustomText className="truncate">{name}</CustomText>
    </>
  `)

  assert.equal(result.fixed, true)
  assert.equal(result.messages.length, 0)
  assert.match(result.output, /title=\{translate\(name\)\}/u)
  assert.match(result.output, /title=\{name\}/u)
})

it('uses a single nested text child or a text-bearing prop', () => {
  const result = verifyAndFix(`
    export const Example = ({ name, content }) => <>
      <div className="truncate"><span>{name}</span></div>
      <Markdown className="line-clamp-2" content={content} />
    </>
  `)

  assert.equal(result.fixed, true)
  assert.equal(result.messages.length, 0)
  assert.match(result.output, /className="truncate" title=\{name\}/u)
  assert.match(result.output, /content=\{content\} title=\{content\}/u)
})

it('resolves truncation classes imported from CSS modules', () => {
  const filename = resolve('plugins/eslint/rules/fixtures/example.tsx')
  const result = verifyAndFix(
    `
      import styles from './truncation.module.css'
      export const Example = ({ name }) => <>
        <span className={styles.singleLine}>{name}</span>
        <span className={styles.multipleLines}>{name}</span>
        <span className={styles.regular}>{name}</span>
      </>
    `,
    filename,
  )

  assert.equal(result.fixed, true)
  assert.equal(result.messages.length, 0)
  assert.equal(result.output.match(/title=\{name\}/gu)?.length, 2)
})
