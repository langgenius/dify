import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vite-plus/test'
import { storyStylingContractRules, stylingContractRules } from '../../lint.config'

function lintFixture(source: string, rules = stylingContractRules) {
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
        rules,
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
      <Explanation className="max-w-65.25 sm:w-60" />
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

it('keeps centered dialogs on DialogContent while DialogPopup places custom surfaces', () => {
  const diagnostics = lintFixture(`
    import { DialogContent, DialogPopup } from '@langgenius/dify-ui/dialog'
    const examples = <>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-160 overflow-hidden" />
      <DialogPopup className="fixed top-2 right-2 bottom-2 flex w-160 flex-col overflow-hidden rounded-xl" />
      <DialogPopup className="fixed top-1/2 left-1/2 w-120 -translate-x-1/2 -translate-y-1/2" />
    </>
  `)
  expect(diagnostics).toHaveLength(4)
  for (const className of ['top-1/2', 'left-1/2', '-translate-x-1/2', '-translate-y-1/2'])
    expect(diagnostics.some(({ message }) => message.includes(`"${className}"`))).toBe(true)
})

it('keeps centered dialog layout owned by the surface', () => {
  const diagnostics = lintFixture(`
    import { DialogContent } from '@langgenius/dify-ui/dialog'
    import { AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
    const examples = <>
      <DialogContent className="flex flex-col" />
      <AlertDialogContent className="flex flex-col" />
    </>
  `)
  expect(diagnostics).toHaveLength(4)
  for (const component of ['DialogContent', 'AlertDialogContent']) {
    for (const className of ['flex', 'flex-col']) {
      expect(
        diagnostics.some(
          ({ message }) => message.includes(`"${className}"`) && message.includes(component),
        ),
      ).toBe(true)
    }
  }
})

it('allows disabling dialog transitions without allowing surface or animation restyling', () => {
  const diagnostics = lintFixture(`
    import { DialogContent as Content } from '@langgenius/dify-ui/dialog'
    import { AlertDialogContent } from '@langgenius/dify-ui/alert-dialog'
    const examples = <>
      <Content className="w-160 data-open:transition-none" />
      <AlertDialogContent className="transition-none" />
      <Content className="motion-reduce:transition-none" />
      <Content className="data-open:scale-95 bg-transparent transition-all" />
      <AlertDialogContent className="data-open:opacity-0" />
    </>
  `)
  expect(diagnostics).toHaveLength(4)
  for (const className of [
    'data-open:scale-95',
    'bg-transparent',
    'transition-all',
    'data-open:opacity-0',
  ])
    expect(diagnostics.some(({ message }) => message.includes(`"${className}"`))).toBe(true)
})

it('keeps focus styling owned by scroll areas, buttons and visible input surfaces', () => {
  const diagnostics = lintFixture(`
    import { ScrollArea, ScrollAreaViewport as Viewport } from '@langgenius/dify-ui/scroll-area'
    import { Button } from '@langgenius/dify-ui/button'
    import { IconButton } from '@langgenius/dify-ui/icon-button'
    import { Input } from '@langgenius/dify-ui/input'
    import { InputGroup, InputGroupInput } from '@langgenius/dify-ui/input-group'
    import { Textarea } from '@langgenius/dify-ui/textarea'
    import { DropdownMenuTrigger } from '@langgenius/dify-ui/dropdown-menu'
    const examples = <>
      <ScrollArea className="rounded-lg ring-2" />
      <Viewport className="focus-visible:ring-2 dark:focus-visible:ring-red-500! outline-hidden focus-visible:inset-ring-2" />
      <Button className="focus-visible:ring-0 focus-visible:inset-ring-0" />
      <DropdownMenuTrigger render={<IconButton aria-label="Open" />} className="focus-visible:outline-2" />
      <Input className="focus:ring-0" />
      <InputGroup className="has-[>input:focus]:ring-2" />
      <InputGroupInput className="focus-visible:ring-2" />
      <Textarea className="focus:outline-none" />
    </>
  `)
  expect(diagnostics).toHaveLength(12)
  for (const component of [
    'ScrollArea',
    'ScrollAreaViewport',
    'Button',
    'IconButton',
    'Input',
    'InputGroup',
    'InputGroupInput',
    'Textarea',
  ])
    expect(diagnostics.some(({ message }) => message.includes(component))).toBe(true)
})

it('allows focus placement, state visibility and decoration without adding an indicator', () => {
  const diagnostics = lintFixture(`
    import { ScrollArea, ScrollAreaViewport } from '@langgenius/dify-ui/scroll-area'
    import { Button } from '@langgenius/dify-ui/button'
    import { IconButton } from '@langgenius/dify-ui/icon-button'
    import { Input } from '@langgenius/dify-ui/input'
    import { InputGroup, InputGroupInput } from '@langgenius/dify-ui/input-group'
    import { TooltipTrigger } from '@langgenius/dify-ui/tooltip'
    const examples = <>
      <ScrollArea className="min-h-0 flex-1 rounded-lg overflow-hidden" />
      <ScrollAreaViewport className="overscroll-contain" />
      <Button className="w-full focus-visible:ring-inset inset-ring-1 inset-ring-transparent focus-visible:shadow-sm" />
      <IconButton aria-label="Open" className="opacity-0 focus-visible:opacity-100 focus-visible:z-1 data-popup-open:bg-state-base-hover" />
      <Input className="ring-inset" />
      <InputGroup className="max-w-80" ><InputGroupInput className="px-0" /></InputGroup>
      <TooltipTrigger className="focus-visible:ring-2" />
      <button className="focus-visible:ring-2" />
    </>
  `)
  expect(diagnostics).toEqual([])
})

it('rejects nested focus variants while keeping relative feature imports outside the web contract', () => {
  const diagnostics = lintFixture(`
    import { Button as Action } from '@langgenius/dify-ui/button'
    import { Input } from './feature'
    const examples = <>
      <Action className="focus-visible:hover:inset-ring-0 dark:focus-within:inset-ring-red-500! focus:hover:inset-ring-2" />
      <Input className="focus:ring-0" />
    </>
  `)
  expect(diagnostics).toHaveLength(3)
})

it('enforces the same contracts for relative imports in design system stories', () => {
  const diagnostics = lintFixture(
    `
    import { Button as Action } from '.'
    import { Input } from '../input'
    import { ScrollAreaViewport } from '../scroll-area'
    const examples = <>
      <Action className="focus-visible:ring-0" />
      <Input className="focus:outline-hidden" />
      <ScrollAreaViewport className="focus-visible:ring-2" />
    </>
  `,
    storyStylingContractRules,
  )
  expect(diagnostics).toHaveLength(3)
})
