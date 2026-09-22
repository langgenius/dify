import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { hintContentRules } from '../../../lint.config'

function lintFixture(source: string) {
  const require = createRequire(import.meta.url)
  const viteRequire = createRequire(require.resolve('vite-plus/package.json'))
  const oxlintBin = join(dirname(dirname(viteRequire.resolve('oxlint'))), 'bin', 'oxlint')
  const directory = mkdtempSync(join(tmpdir(), 'dify-hint-contract-'))
  try {
    writeFileSync(
      join(directory, '.oxlintrc.json'),
      JSON.stringify({
        categories: { correctness: 'off' },
        jsPlugins: [require.resolve('@shadcn/lint')],
        rules: hintContentRules,
      }),
    )
    writeFileSync(join(directory, 'fixture.tsx'), source)
    const result = spawnSync(
      process.execPath,
      [oxlintBin, '--config', join(directory, '.oxlintrc.json'), '--format', 'json', 'fixture.tsx'],
      { cwd: directory, encoding: 'utf8' },
    )
    expect(result.error).toBeUndefined()
    expect([0, 1], result.stderr + result.stdout).toContain(result.status)
    return JSON.parse(result.stdout).diagnostics as Array<{ message: string }>
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

it('allows shortcut row composition and width constraints without restricting other components', () => {
  const diagnostics = lintFixture(`
    import { TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
    import { PopoverContent } from '@langgenius/dify-ui/popover'
    import { InfotipContent, InfotipTrigger } from '@langgenius/dify-ui/infotip'
    const examples = <>
      <TooltipContent className="flex items-center gap-1 max-w-60" />
      <TooltipContent className="w-58 max-w-65" />
      <TooltipContent className="flex items-center gap-1 max-w-none" />
      <TooltipContent />
      <TooltipTrigger className="border-0 bg-transparent" />
      <PopoverContent className="shadow-none" />
      <InfotipContent className="w-60 whitespace-pre-wrap" />
      <InfotipTrigger className="ml-1 text-text-warning" />
      <div className="shadow-none" />
    </>
  `)
  expect(diagnostics).toEqual([])
})

it('rejects surface overrides through aliases, variants, important modifiers, and arbitrary properties', () => {
  const classes = [
    'p-1.5',
    'overflow-clip',
    'text-start',
    'wrap-break-word',
    'transition-opacity',
    'data-ending-style:opacity-0',
    'origin-(--transform-origin)',
    'shadow-[0px_12px_16px_-4px_var(--color-shadow-shadow-5),0px_4px_6px_-2px_var(--color-shadow-shadow-1)]',
    'rounded-lg',
    'system-xs-medium',
    'text-text-secondary',
    'bg-components-tooltip-bg',
    'border-[0.5px]',
    'border-components-panel-border',
    'border-x-0',
    'dark:shadow-none!',
    'backdrop-blur-[5px]',
    '[box-shadow:none]',
    '[background:red]',
  ]
  const diagnostics = lintFixture(`
    import { TooltipContent as Hint } from '@langgenius/dify-ui/tooltip'
    const example = <Hint className="${classes.join(' ')}" />
  `)
  expect(diagnostics).toHaveLength(classes.length)
  for (const className of classes)
    expect(diagnostics.some(({ message }) => message.includes(`"${className}"`))).toBe(true)
})

it('rejects caller typography, padding, alignment, visibility, and positioning policies', () => {
  const classes = [
    'rounded-xl',
    'px-4',
    'py-3.5',
    'body-xs-regular',
    'text-left',
    'text-text-primary',
    'mr-1',
    'hidden!',
    'z-50',
    'flex-1',
    'items-start',
    'gap-2',
    'truncate',
    'whitespace-nowrap',
  ]
  const diagnostics = lintFixture(`
    import { TooltipContent } from '@langgenius/dify-ui/tooltip'
    const example = <TooltipContent className="${classes.join(' ')}" />
  `)
  expect(diagnostics).toHaveLength(classes.length)
  for (const className of classes)
    expect(diagnostics.some(({ message }) => message.includes(`"${className}"`))).toBe(true)
})

it('checks readable class helpers, local values, and props spreads', () => {
  const diagnostics = lintFixture(`
    import { TooltipContent } from '@langgenius/dify-ui/tooltip'
    import { cn } from '@langgenius/dify-ui/cn'
    const classes = 'shadow-none'
    const props = { className: 'border-0' }
    const example = <>
      <TooltipContent className={cn('max-w-60', classes)} />
      <TooltipContent {...props} />
    </>
  `)
  expect(diagnostics).toHaveLength(2)
  expect(diagnostics.some(({ message }) => message.includes('"shadow-none"'))).toBe(true)
  expect(diagnostics.some(({ message }) => message.includes('"border-0"'))).toBe(true)
})

it('allows Infotip widths and content line breaks while retaining its own content contract', () => {
  const diagnostics = lintFixture(`
    import { InfotipContent as Explanation } from '@langgenius/dify-ui/infotip'
    const examples = <>
      <Explanation />
      <Explanation className="w-60 max-w-75 whitespace-pre-wrap" />
      <Explanation className="max-w-[261px] sm:w-60" />
      <Explanation className={expanded ? 'w-60' : 'w-45'} />
    </>
  `)
  expect(diagnostics).toEqual([])
})

it('rejects Infotip surface restyling and repeated defaults, including Tooltip-only layouts', () => {
  const classes = [
    'p-1.5',
    'px-3',
    'py-2',
    'rounded-lg',
    'border-[0.5px]',
    'border-components-panel-border',
    'bg-components-tooltip-bg',
    'text-text-secondary',
    'system-xs-medium',
    'text-start',
    'wrap-break-word',
    'dark:shadow-none!',
    'backdrop-blur-[5px]',
    'transition-opacity',
    'data-ending-style:opacity-0',
    '[box-shadow:none]',
    '[&>p]:text-red-500',
    'flex',
    'flex-1',
    'items-center',
    'gap-1',
    'truncate',
    'whitespace-nowrap',
    'break-all',
  ]
  const diagnostics = lintFixture(`
    import { InfotipContent as Explanation } from '@langgenius/dify-ui/infotip'
    const example = <Explanation className="${classes.join(' ')}" />
  `)
  expect(diagnostics).toHaveLength(classes.length)
  for (const className of classes)
    expect(diagnostics.some(({ message }) => message.includes(`"${className}"`))).toBe(true)
})

it('checks Infotip class helpers and same-file props without restricting unrelated imports', () => {
  const diagnostics = lintFixture(`
    import { InfotipContent } from '@langgenius/dify-ui/infotip'
    import { InfotipContent as Unrelated } from './feature'
    import { cn } from '@langgenius/dify-ui/cn'
    const surface = 'shadow-none'
    const popup = { className: 'p-2' }
    const examples = <>
      <InfotipContent className={cn('w-60', surface)} />
      <InfotipContent {...popup} />
      <Unrelated className="p-2 shadow-none" />
    </>
  `)
  expect(diagnostics).toHaveLength(2)
  expect(diagnostics.some(({ message }) => message.includes('"shadow-none"'))).toBe(true)
  expect(diagnostics.some(({ message }) => message.includes('"p-2"'))).toBe(true)
})
