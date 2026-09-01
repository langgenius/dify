import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import tsParser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import { it } from 'vitest'
import rule from './require-title-for-truncated-text.js'
import './fixtures/truncation.module.css'

const plugin = {
  rules: {
    'require-title-for-truncated-text': rule,
  },
}

function verifyAndFix(code, filename = 'test.tsx') {
  const linter = new Linter({ cwd: resolve('..') })
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
        rules: { 'dify/require-title-for-truncated-text': 'warn' },
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

it('reports static classes, class helpers, constants, and inline styles without fixing', () => {
  const code = `
    const truncatedClassName = cn('min-w-0', condition && 'md:truncate')
    export const Example = ({ itemName, label }) => <>
      <span className={truncatedClassName}>{itemName}</span>
      <p className={cn('line-clamp-2', condition && 'text-secondary')}>{label}</p>
      <div style={{ textOverflow: 'ellipsis' }}>Description</div>
    </>
  `
  const result = verifyAndFix(code)

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 3)
  assert.ok(result.messages.every((message) => message.severity === 1))
  assert.equal(result.output, code)
})

it('resolves truncation variables from the active lexical scope', () => {
  const shadowedParameterCode = `
    const className = 'truncate'
    const style = { textOverflow: 'ellipsis' }
    export const Example = ({ className, style, label }) => <>
      <span className={className}>{label}</span>
      <span style={style}>{label}</span>
    </>
  `
  const shadowedParameterResult = verifyAndFix(shadowedParameterCode)

  assert.equal(shadowedParameterResult.fixed, false)
  assert.equal(shadowedParameterResult.messages.length, 0)
  assert.equal(shadowedParameterResult.output, shadowedParameterCode)

  const nestedBindingResult = verifyAndFix(`
    const className = 'regular'
    const style = { color: 'red' }
    export const Example = ({ label }) => {
      const className = 'truncate'
      const style = { textOverflow: 'ellipsis' }
      return <>
        <span className={className}>{label}</span>
        <span style={style}>{label}</span>
      </>
    }
  `)

  assert.equal(nestedBindingResult.fixed, false)
  assert.equal(nestedBindingResult.messages.length, 2)
  assert.ok(nestedBindingResult.messages.every((message) => message.severity === 1))
})

it('reports an empty title without replacing it', () => {
  const code = `
    export const Example = ({ name }) => <span className="truncate" title="">{name}</span>
  `
  const result = verifyAndFix(code)

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].severity, 1)
  assert.equal(result.messages[0].messageId, 'emptyTitle')
  assert.equal(result.output, code)
})

it('reports custom components without fixing them', () => {
  const code = `
    export const Example = ({ name }) => (
      <CustomText className="truncate">{name}</CustomText>
    )
  `
  const result = verifyAndFix(code)

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].severity, 1)
  assert.equal(result.output, code)
})

it('ignores expressions that may execute user code', () => {
  const code = `
    export const Example = ({ item }) => {
      let index = 0
      return <>
        <span className="truncate">{item.name}</span>
        <span className="truncate" title="">{getLabel()}</span>
        <span className="truncate">{index++}</span>
        <Markdown className="line-clamp-2" content={getContent()} />
      </>
    }
  `
  const result = verifyAndFix(code)

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 0)
  assert.equal(result.output, code)
})

it('reports a single nested text child or a text-bearing prop without fixing', () => {
  const result = verifyAndFix(`
    export const Example = ({ name, content }) => <>
      <div className="truncate"><span>{name}</span></div>
      <Markdown className="line-clamp-2" content={content} />
    </>
  `)

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 2)
  assert.ok(result.messages.every((message) => message.severity === 1))
})

it('checks Dify UI single text but ignores multiple text children', () => {
  const filename = resolve('../packages/dify-ui/src/example.tsx')
  const result = verifyAndFix(
    `
      export const Example = ({ primary, secondary }) => <>
        <span className="truncate">{primary}</span>
        <span className="truncate">{primary}{secondary}</span>
        <div className="line-clamp-2">
          <span>{primary}</span>
          <span>{secondary}</span>
        </div>
      </>
    `,
    filename,
  )

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].severity, 1)
})

it('does not count non-text conditional children as additional text', () => {
  const result = verifyAndFix(`
    export const Example = ({ primary, showOverlay }) => (
      <span className="truncate">
        {primary}
        {showOverlay && <span aria-hidden />}
      </span>
    )
  `)

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 1)
  assert.equal(result.messages[0].messageId, 'missingTitle')
})

it('resolves truncation classes imported from CSS modules', () => {
  const filename = resolve('plugins/eslint/rules/fixtures/example.tsx')
  const result = verifyAndFix(
    `
      import styles from './truncation.module.css'
      export const Example = ({ name }) => <>
        <span className={styles.singleLine}>{name}</span>
        <span className={styles.multipleLines}>{name}</span>
        <span className={styles.noClamp}>{name}</span>
        <span className={styles.zeroClamp}>{name}</span>
        <span className={styles.unsetClamp}>{name}</span>
        <span className={styles.regular}>{name}</span>
      </>
      export const Shadowed = ({ styles, name }) => (
        <span className={styles.singleLine}>{name}</span>
      )
    `,
    filename,
  )

  assert.equal(result.fixed, false)
  assert.equal(result.messages.length, 2)
  assert.ok(result.messages.every((message) => message.severity === 1))
})
