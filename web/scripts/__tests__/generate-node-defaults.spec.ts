// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { canvasDefault, renderNodeDefaults, syncNodeDefaults } from '../generate-node-defaults'

describe('generated node defaults', () => {
  it('drops keys that start with an underscore at any depth', () => {
    expect(
      canvasDefault({
        _children: [],
        cases: [{ case_id: 'true', _targetBranches: [{ id: 'x' }] }],
        nested: { keep: 1, _hidden: { deeper: true } },
      }),
    ).toEqual({ cases: [{ case_id: 'true' }], nested: { keep: 1 } })
  })

  it('drops the top-level type, title, desc and version but keeps them deeper', () => {
    expect(
      canvasDefault({
        type: 'http-request',
        title: 'HTTP',
        desc: '',
        version: '2',
        authorization: { type: 'no-auth' },
        classes: [{ id: '1', name: 'a' }],
      }),
    ).toEqual({ authorization: { type: 'no-auth' }, classes: [{ id: '1', name: 'a' }] })
  })

  it('drops null values', () => {
    expect(canvasDefault({ config: null, score_threshold: null, on: false })).toEqual({ on: false })
  })

  it('drops empty strings, arrays and records at any depth but keeps zero, false and blank text', () => {
    expect(canvasDefault({ a: '', b: [], c: {}, d: { e: '' }, f: 0, g: false, h: ' ' })).toEqual({
      f: 0,
      g: false,
      h: ' ',
    })
  })

  it('drops an empty value inside an array item, and an item left empty', () => {
    expect(canvasDefault({ p: [{ role: 'system', text: '' }] })).toEqual({
      p: [{ role: 'system' }],
    })
    expect(canvasDefault({ q: [{ x: '' }] })).toEqual({})
  })

  it('drops null array items at any depth', () => {
    expect(
      canvasDefault({ items: [null, 'a', { list: [null, 1], gone: null }], empty: [null] }),
    ).toEqual({ items: ['a', { list: [1] }] })
  })

  it('renders sorted keys with a trailing newline', () => {
    const rendered = renderNodeDefaults({
      end: { outputs: [] },
      answer: { variables: [], answer: '' },
    })
    expect(rendered).toBe('{\n  "answer": {},\n  "end": {}\n}\n')
  })
})

describe('checking the generated file', () => {
  let directory: string
  let file: URL

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'node-defaults-'))
    file = pathToFileURL(join(directory, 'canvas_defaults.json'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes the file when not checking', async () => {
    await syncNodeDefaults({ file, generated: '{}\n', check: false })

    expect(await readFile(file, 'utf8')).toBe('{}\n')
  })

  it('passes when the file matches', async () => {
    await writeFile(file, '{}\n')

    await expect(
      syncNodeDefaults({ file, generated: '{}\n', check: true }),
    ).resolves.toBeUndefined()
  })

  it('fails when the file differs, and leaves it as it is', async () => {
    await writeFile(file, '{"end": {}}\n')

    await expect(syncNodeDefaults({ file, generated: '{}\n', check: true })).rejects.toThrow(
      'stale',
    )
    expect(await readFile(file, 'utf8')).toBe('{"end": {}}\n')
  })

  it('fails when the file is missing', async () => {
    await expect(syncNodeDefaults({ file, generated: '{}\n', check: true })).rejects.toThrow(
      'stale',
    )
  })
})
