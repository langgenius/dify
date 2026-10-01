import type { TestContext } from 'vite-plus/test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync, inflateSync } from 'node:zlib'
import sharp from 'sharp'
import { it, vi } from 'vite-plus/test'
import {
  escapeAnnotation,
  exceedsThreshold,
  git,
  ignoredReason,
  imagePaths,
  inspectImage,
  loadIgnoreRules,
  main,
} from './check-image-resources.ts'
import { compressRaster, compressSvg, parseSvg, pngChunks } from './image-optimizer.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const namespace = 'http://www.w3.org/2000/svg'
const xlink = 'http://www.w3.org/1999/xlink'
const write = (root: string, name: string, data: string | Buffer) => {
  const p = path.join(root, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, data)
  return p
}
const wrap = (body: string) =>
  Buffer.from(
    `<svg xmlns="${namespace}" xmlns:s="${namespace}" xmlns:xlink="${xlink}" width="80" height="80" viewBox="0 0 80 80">${body}</svg>`,
  )
const embedded = (data: Buffer, attribute = 'href') =>
  wrap(
    `<image width="80" height="80" ${attribute}="data:image/png;base64,${data.toString('base64')}"/>`,
  )
const png = (optimized = false) =>
  sharp({
    create: {
      width: 80,
      height: 80,
      channels: 4,
      background: { r: 20, g: 80, b: 120, alpha: 0.55 },
    },
  })
    .png({ compressionLevel: optimized ? 9 : 0 })
    .toBuffer()
const nodes = (doc: ReturnType<typeof parseSvg>) => Array.from(doc.getElementsByTagName('*'))
function structure(data: Buffer) {
  return nodes(parseSvg(data)).map((node) => ({
    name: node.nodeName,
    attributes: Object.fromEntries(
      Array.from(node.attributes).map((attr) => [attr.name, attr.value]),
    ),
  }))
}
function chunk(type: string, data: Buffer) {
  const buffer = Buffer.alloc(data.length + 12)
  buffer.writeUInt32BE(data.length)
  buffer.write(type, 4)
  data.copy(buffer, 8)
  buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4)
  return buffer
}
function png16(type: 0 | 2 | 4 | 6) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(80)
  header.writeUInt32BE(80, 4)
  header[8] = 16
  header[9] = type
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type]
  const row = Buffer.alloc(80 * channels * 2 + 1, 0x34)
  row[0] = 0
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: 80 }, () => row)), { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function repository(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'image-resources-'))
  t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))
  git(['init', '-q'], root)
  git(['config', 'user.email', 'test@example.invalid'], root)
  git(['config', 'user.name', 'Test'], root)
  const scripts = path.join(root, 'packages/image-resources')
  write(root, 'packages/image-resources/ignore.json', '[]')
  write(root, 'packages/image-resources/package.json', '{"type":"module"}')
  for (const name of ['check-image-resources.ts', 'image-optimizer.ts'])
    fs.copyFileSync(path.join(here, name), path.join(scripts, name))
  fs.symlinkSync(path.join(here, 'node_modules'), path.join(scripts, 'node_modules'), 'dir')
  return {
    root,
    scripts,
    cli: (args: string[], env: NodeJS.ProcessEnv = {}) =>
      spawnSync(process.execPath, [path.join(scripts, 'check-image-resources.ts'), ...args], {
        encoding: 'utf8',
        env: { ...process.env, ...env },
      }),
  }
}

it('strict 25 percent boundary without a byte cap', () => {
  assert.equal(exceedsThreshold(100, 75), false)
  assert.equal(exceedsThreshold(100, 74), true)
  assert.equal(exceedsThreshold(100, 110), false)
})

it('PNG recompression preserves exact scanlines, pixels and transparency', async (t) => {
  const { root } = repository(t)
  const original = await png()
  const filename = write(root, 'image.png', original)
  const result = await inspectImage('image.png', root)
  assert.equal(result.status, 'error')
  assert.ok(result.candidate)
  assert.deepEqual(fs.readFileSync(filename), original)
  const scanlines = (data: Buffer) =>
    inflateSync(
      Buffer.concat(
        pngChunks(data)
          .filter((c) => c.type === 'IDAT')
          .map((c) => c.data),
      ),
    )
  assert.deepEqual(scanlines(result.candidate), scanlines(original))
  assert.deepEqual(
    await sharp(result.candidate).raw().toBuffer(),
    await sharp(original).raw().toBuffer(),
  )
  write(root, 'image.png', result.candidate)
  assert.equal((await inspectImage('image.png', root)).status, 'passed')
})

it('PNG preserves all non-IDAT chunks including colour and textual metadata', async () => {
  const original = await png()
  const gamma = Buffer.alloc(4)
  gamma.writeUInt32BE(45455)
  const source = Buffer.concat([
    original.subarray(0, 33),
    chunk('gAMA', gamma),
    chunk('sRGB', Buffer.from([0])),
    chunk('tEXt', Buffer.from('Author\0Test author')),
    original.subarray(33),
  ])
  const candidate = await compressRaster(source)
  const metadata = (data: Buffer) =>
    pngChunks(data)
      .filter((c) => c.type !== 'IDAT')
      .map((c) => c.bytes)
  assert.deepEqual(metadata(candidate.data), metadata(source))
})

it('large incompressible PNG passes regardless of absolute size', async (t) => {
  const { root } = repository(t)
  const data = await sharp(randomBytes(512 * 512 * 3), {
    raw: { width: 512, height: 512, channels: 3 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer()
  assert.ok(data.length > 512000)
  write(root, 'large.png', data)
  assert.equal((await inspectImage('large.png', root)).status, 'passed')
})

it('16-bit PNG remains skipped both standalone and embedded', async () => {
  for (const type of [0, 2, 4, 6] as const) {
    const original = png16(type)
    const result = await compressRaster(original)
    assert.match(result.method, /skipped: 16-bit PNG/)
    assert.deepEqual(result.data, original)
    const svg = await compressSvg(embedded(original))
    assert.match(svg.method, /embedded skipped: 16-bit PNG/)
    const href = parseSvg(svg.data).getElementsByTagName('image')[0]!.getAttribute('href')
    assert.deepEqual(Buffer.from(href!.split(',')[1]!, 'base64'), original)
  }
})

it('JPEG and WebP are labelled lossy, preserve dimensions and EXIF orientation', async () => {
  for (const format of ['jpeg', 'webp'] as const) {
    const source = await sharp({
      create: { width: 80, height: 60, channels: 3, background: 'red' },
    })
      .withMetadata({ orientation: 6, density: 144 })
      .toFormat(format)
      .toBuffer()
    const before = await sharp(source).metadata()
    const trial = await compressRaster(source)
    assert.match(trial.method, /lossy/)
    const after = await sharp(trial.data).metadata()
    assert.equal(after.width, before.width)
    assert.equal(after.height, before.height)
    assert.equal(after.orientation, before.orientation)
    assert.equal(after.density, before.density)
    assert.deepEqual(after.icc, before.icc)
  }
})

it('animated PNG and multi-page GIF are skipped', async () => {
  const source = await png()
  const control = Buffer.alloc(8)
  control.writeUInt32BE(2)
  const apng = Buffer.concat([source.subarray(0, 33), chunk('acTL', control), source.subarray(33)])
  assert.match((await compressRaster(apng)).method, /skipped: animated/)
  const data = await sharp(Buffer.concat([Buffer.alloc(300, 0), Buffer.alloc(300, 255)]), {
    raw: { width: 10, height: 20, channels: 3, pageHeight: 10 },
  })
    .gif({ delay: [100, 100], loop: 0 })
    .toBuffer()
  assert.equal((await sharp(data).metadata()).pages, 2)
  assert.match((await compressRaster(data)).method, /skipped: animated/)
})

it('unsupported static raster formats explicitly skip', async () => {
  const gif = await sharp(await png())
    .gif()
    .toBuffer()
  assert.match((await compressRaster(gif)).method, /skipped: no optimizer/)
})

it('embedded Base64 handles both href forms, whitespace and XML entities', async () => {
  const original = await png()
  const encoded = original.toString('base64')
  for (const attribute of ['href', 'xlink:href']) {
    for (const payload of [
      encoded,
      encoded.match(/.{1,64}/g)!.join('\n'),
      encoded.match(/.{1,64}/g)!.join('\r\n\t'),
      encoded.match(/.{1,64}/g)!.join('&#10;'),
      `&#105;${encoded.slice(1)}`,
    ]) {
      const source = Buffer.from(embedded(original, attribute).toString().replace(encoded, payload))
      const trial = await compressSvg(source)
      assert.ok(exceedsThreshold(source.length, trial.data.length))
      assert.match(trial.method, /embedded PNG/)
      const image = parseSvg(trial.data).getElementsByTagName('image')[0]!
      assert.equal(image.getAttribute('width'), '80')
      assert.equal(image.getAttribute('height'), '80')
      const href = image.getAttribute(attribute)
      const candidate = Buffer.from(href!.split(',')[1]!, 'base64')
      assert.deepEqual(
        await sharp(candidate).raw().toBuffer(),
        await sharp(original).raw().toBuffer(),
      )
    }
  }
})

it('reports SVG declarations and each embedded raster in check, fix and CI summaries', async (t) => {
  const { root, cli } = repository(t)
  const raster = await png()
  const svg = wrap(
    `<image href="data:image/png;base64,${raster.toString('base64')}"/><image xlink:href="data:image/png;base64,${raster.toString('base64')}"/>`,
  )
  write(root, 'image.svg', svg)
  git(['add', 'image.svg'], root)
  const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path.join(root, 'summary.md') }
  const checked = cli(['--all'], env)
  assert.equal(checked.status, 1, checked.stderr)
  assert.match(checked.stdout, /SVG declared width=/)
  assert.match(checked.stdout, /not rendered dimensions/)
  for (const index of [1, 2]) {
    const detail = `embedded image #${index}: PNG 80 × 80 px, ${raster.length.toLocaleString('en-US')} B (source bytes)`
    assert.ok(checked.stdout.includes(detail))
    assert.ok(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8').includes(detail))
  }
  const fixed = cli(['--all', '--fix'])
  assert.equal(fixed.status, 0, fixed.stderr)
  assert.match(fixed.stdout, /embedded image #2: PNG 80 × 80 px/)
  const repeated = cli(['--all'])
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.match(repeated.stdout, /embedded image #1: PNG 80 × 80 px/)
})

it('keeps declared SVG units and missing dimensions distinct from raster pixels', async () => {
  for (const attrs of ['', 'width="100%" height="2em" viewBox="0 0 360 128"']) {
    const trial = await compressSvg(Buffer.from(`<svg xmlns="${namespace}" ${attrs}/>`))
    assert.equal(trial.details?.length, 1)
    if (attrs) {
      assert.match(trial.details[0]!, /width="100%", height="2em", viewBox="0 0 360 128"/)
    } else {
      assert.match(trial.details[0]!, /width=null, height=null, viewBox=null/)
    }
  }
})

it('reports metadata on whitespace-sensitive SVGs without changing their skipped behavior', async () => {
  const raster = png16(6)
  const source = wrap(
    `<text>Keep spaces</text><image href="data:image/png;base64,${raster.toString('base64')}"/><image href="data:image/bmp;base64,Qk0="/><image href="data:image/png;base64,%%%"/>`,
  )
  const trial = await compressSvg(source)
  assert.equal(trial.skipped, true)
  assert.deepEqual(trial.data, source)
  assert.match(trial.details![1]!, /PNG 80 × 80 px/)
  assert.match(trial.details![2]!, /dimensions unavailable, 2 B/)
  assert.match(trial.details![3]!, /metadata unavailable/)
})

it('unpadded embedded Base64 preserves pixels and works through CLI check and fix', async (t) => {
  const { root, cli } = repository(t)
  const source = await png()
  const padding = new Set<number>()
  for (const length of [0, 1, 2]) {
    const original = Buffer.concat([
      source.subarray(0, 33),
      chunk('tEXt', Buffer.from(`Comment\0${'x'.repeat(length)}`)),
      source.subarray(33),
    ])
    const encoded = original.toString('base64')
    padding.add(encoded.length - encoded.replace(/=+$/, '').length)
    for (const attribute of ['href', 'xlink:href']) {
      // Percent-encoded ASCII whitespace is permitted too, including form feed.
      const payload = encoded
        .replace(/=+$/, '')
        .match(/.{1,64}/g)!
        .join('%09%0A%0C%0D%20')
      const svg = Buffer.from(embedded(original, attribute).toString().replace(encoded, payload))
      const trial = await compressSvg(svg)
      assert.match(trial.method, /embedded PNG/)
      const href = parseSvg(trial.data).getElementsByTagName('image')[0]!.getAttribute(attribute)!
      const candidate = Buffer.from(href.split(',')[1]!, 'base64')
      assert.deepEqual(
        await sharp(candidate).raw().toBuffer(),
        await sharp(original).raw().toBuffer(),
      )
      write(root, `${length}-${attribute.replace(':', '-')}.svg`, svg)
    }
  }
  assert.deepEqual([...padding].sort(), [0, 1, 2])
  git(['add', '*.svg'], root)
  const checked = cli(['--all'])
  assert.equal(checked.status, 1, checked.stderr)
  assert.match(checked.stdout, /6 failures/)
  assert.ok(!checked.stdout.includes('Unable to inspect'))
  const fixed = cli(['--all', '--fix'])
  assert.equal(fixed.status, 0, fixed.stderr)
  assert.match(fixed.stdout, /6 fixed/)
  assert.equal(cli(['--all']).status, 0)
})

it('embedded Base64 rejects invalid alphabet, lengths, padding and non-ASCII whitespace', async () => {
  for (const payload of [
    'A',
    'AAAAA',
    'AA=',
    'AAA==',
    'AAAA=',
    'AA===',
    'A=AA',
    'AA-_',
    'AA%0B',
    'AA%C2%A0',
    'AA%FF',
  ]) {
    await assert.rejects(
      compressSvg(wrap(`<image href="data:image/png;base64,${payload}"/>`)),
      /Invalid embedded Base64 image/,
      payload,
    )
  }
})

it('percent-encoded binary data URLs are recompressed without UTF-8 corruption', async () => {
  const source = await png()
  const url = [...source].map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join('')
  const trial = await compressSvg(wrap(`<image href="data:image/png,${url}"/>`))
  assert.match(trial.method, /embedded PNG/)
})

it('external image URLs are not fetched or inlined', async () => {
  const trial = await compressSvg(wrap('<image href="https://example.invalid/image.png"/>'))
  assert.ok(trial.data.includes('https://example.invalid/image.png'))
  assert.ok(!trial.data.includes('data:image'))
})

it('CSS groups, inline styles and external stylesheets retain structure', async () => {
  for (const body of [
    '<style>g {opacity:0.5}</style><g><rect width="80" height="80"/></g>',
    '<style>rect {fill:red}</style><rect style="fill:blue" width="80" height="80"/>',
    '<style>rect {fill:red}</style><rect style="fill:black" width="80" height="80"/>',
    '<link rel="stylesheet" href="style.css"/><rect width="80"/>',
  ]) {
    const source = wrap(body)
    const trial = await compressSvg(source)
    assert.deepEqual(structure(trial.data), structure(source))
    assert.equal(
      parseSvg(trial.data).getElementsByTagName('style')[0]?.textContent,
      parseSvg(source).getElementsByTagName('style')[0]?.textContent,
    )
  }
  const source = Buffer.from(
    `<?xml-stylesheet href="style.css" type="text/css"?>${wrap('<rect width="80"/>')}`,
  )
  assert.ok(
    (await compressSvg(source)).data.includes(
      '<?xml-stylesheet href="style.css" type="text/css"?>',
    ),
  )
})

it('CLI fix preserves CSS precedence and SVG 2, xlink, and external sprite definitions', async (t) => {
  const { root, cli } = repository(t)
  const bodies = [
    '<style>g {opacity:0.5}</style><g><rect width="80" height="80"/></g>',
    '<style>rect {fill:red}</style><rect style="fill:blue" width="80" height="80"/>',
    '<style>rect {fill:red}</style><rect style="fill:black" width="80" height="80"/>',
    '<defs><rect id="tile" width="80" height="80"/></defs><use href="#tile"/>',
    '<defs><rect id="tile" width="80" height="80"/></defs><use xlink:href="#tile"/>',
    '<defs><symbol id="check" viewBox="0 0 20 20"><path d="M1 10 L8 17 L19 1"/></symbol></defs>',
    '<defs><linearGradient id="base"><stop offset="0" stop-color="red"/></linearGradient></defs><linearGradient id="copy" href="#base"/>',
  ]
  const originals = bodies.map((body, i) => {
    const source = wrap(`${'\n    '.repeat(80)}${body}`)
    write(root, `images/${i}.svg`, source)
    return source
  })
  write(root, 'page.html', '<svg><use href="images/5.svg#check"/></svg>')
  git(['add', 'images', 'page.html'], root)
  const result = cli(['--all', '--fix'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /7 fixed/)
  for (const [i, source] of originals.entries()) {
    const after = fs.readFileSync(path.join(root, `images/${i}.svg`))
    assert.deepEqual(structure(after), structure(source))
    assert.equal((await inspectImage(`images/${i}.svg`, root)).status, 'passed')
    assert.equal(
      parseSvg(after).getElementsByTagName('style')[0]?.textContent,
      parseSvg(source).getElementsByTagName('style')[0]?.textContent,
    )
  }
})

it('geometry, metadata, accessibility and protected comments survive SVGO', async () => {
  const source = wrap(
    '<!--! License notice --><!-- editor comment --><title id="title">Accessible icon</title><desc>Description</desc><metadata>Author data</metadata><g transform="translate(0.123456789 0.987654321)"><path id="shape" fill="black" d="M0.123456789 1 L2.987654321 3"/></g>',
  )
  const trial = await compressSvg(source)
  assert.deepEqual(structure(trial.data), structure(source))
  assert.ok(trial.data.includes('<!--! License notice'))
  assert.ok(!trial.data.includes('editor comment'))
  for (const tag of ['title', 'desc', 'metadata'])
    assert.equal(
      parseSvg(trial.data).getElementsByTagName(tag)[0]!.textContent,
      parseSvg(source).getElementsByTagName(tag)[0]!.textContent,
    )
})

it('whitespace-sensitive SVGs remain byte-identical through check and fix', async (t) => {
  const { root, cli } = repository(t)
  const bodies = [
    '<foreignObject width="100" height="100"><div xmlns="http://www.w3.org/1999/xhtml"><span>Hello</span> <span>world</span></div></foreignObject>',
    '<s:text xml:space="preserve">  Hello world  </s:text>',
    '<text>Hello <tspan>world</tspan></text>',
    '<g xml:space="preserve"><rect width="10"/></g>',
    '<s:foreignObject><div xmlns="http://www.w3.org/1999/xhtml">Hello world</div></s:foreignObject>',
  ]
  const originals = bodies.map((body) => wrap(`${'\n    '.repeat(80)}${body}`))
  originals.push(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve">  <rect width="10"/>  </svg>',
    ),
  )
  for (const [i, source] of originals.entries()) {
    write(root, `images/${i}.svg`, source)
    const trial = await compressSvg(source)
    assert.deepEqual(trial.data, source)
    assert.match(trial.method, /skipped: SVG contains whitespace-sensitive/)
  }
  git(['add', 'images'], root)
  for (const args of [[], ['--fix']]) {
    const result = cli(['--all', ...args])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /6 skipped/)
    assert.match(result.stdout, /0 fixed/)
    for (const [i, source] of originals.entries())
      assert.deepEqual(fs.readFileSync(path.join(root, `images/${i}.svg`)), source)
  }
})

it('formatting-only SVG redundancy is compressed', async () => {
  const source = wrap(`${'\n        '.repeat(100)}<rect width="10" height="10"/>`)
  assert.ok(exceedsThreshold(source.length, (await compressSvg(source)).data.length))
})

it('empty, corrupt, malformed XML and embedded Base64 produce failures', async (t) => {
  const { root } = repository(t)
  for (const [name, data] of [
    ['empty.png', ''],
    ['bad.png', 'not a PNG'],
    ['bad.svg', '<svg>'],
    ['bad.svg', '<svg><image href="data:image/png;base64,%%%"/></svg>'],
  ] as const) {
    write(root, name, data)
    assert.equal((await inspectImage(name, root)).status, 'error')
  }
  const corrupt = await png()
  corrupt[40] = corrupt[40]! ^ 1
  write(root, 'crc.png', corrupt)
  assert.match((await inspectImage('crc.png', root)).message, /checksum/)
})

it('symlinks are never optimized', async (t) => {
  const { root } = repository(t)
  write(root, 'original.png', await png())
  fs.symlinkSync(path.join(root, 'original.png'), path.join(root, 'link.png'))
  assert.match((await inspectImage('link.png', root)).message, /symlinks/)
})

it('annotation escaping prevents injected workflow commands', () => {
  assert.ok(!/[\r\n,:]/.test(escapeAnnotation('image,prop:x%\r\n::error::injected')))
})

it('ignore validation and matching preserve full-path case-sensitive patterns', async (t) => {
  const { root } = repository(t)
  const config = (value: unknown) =>
    write(root, 'packages/image-resources/ignore.json', JSON.stringify(value))
  assert.deepEqual(await loadIgnoreRules(root), [])
  const rules = [
    { pattern: 'logo.png', reason: 'Brand asset' },
    { pattern: 'fixtures/*.png', reason: 'Encoding fixtures' },
  ]
  config(rules)
  const loaded = await loadIgnoreRules(root)
  for (const name of ['logo.png', 'fixtures/a.png', 'fixtures/nested/a.png'])
    assert.ok(ignoredReason(name, loaded))
  for (const name of ['other/logo.png', 'logo.PNG', 'fixtures/a.svg'])
    assert.equal(ignoredReason(name, loaded), undefined)
  assert.ok(ignoredReason('icon(1).png', [{ pattern: 'icon(1).png', reason: 'test' }]))
  assert.equal(ignoredReason('icon1.png', [{ pattern: 'icon(1).png', reason: 'test' }]), undefined)
  assert.equal(ignoredReason('[ab].png', [{ pattern: '[ab].png', reason: 'test' }]), undefined)
  assert.ok(ignoredReason('b.png', [{ pattern: '[!a].png', reason: 'test' }]))
  assert.equal(ignoredReason('a.png', [{ pattern: '[!a].png', reason: 'test' }]), undefined)
  for (const invalid of [
    {},
    ['*.png'],
    [{ pattern: '*.png' }],
    [{ pattern: '*.png', reason: ' ' }],
    [{ pattern: '/logo.png', reason: 'test' }],
    [{ pattern: '../logo.png', reason: 'test' }],
  ]) {
    config(invalid)
    await assert.rejects(loadIgnoreRules(root))
  }
})

it('ignore consistently controls check, fix, and summaries', async (t) => {
  const { root, cli } = repository(t)
  const original = await png()
  write(root, 'fixtures/keep.png', original)
  git(['add', 'fixtures'], root)
  write(
    root,
    'packages/image-resources/ignore.json',
    JSON.stringify([{ pattern: 'fixtures/*.png', reason: 'Preserve encoding fixture' }]),
  )
  const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path.join(root, 'summary.md') }
  for (const args of [[], ['--fix']]) {
    const result = cli(['--all', ...args], env)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /1 ignored/)
    assert.match(result.stdout, /Preserve encoding fixture/)
    assert.deepEqual(fs.readFileSync(path.join(root, 'fixtures/keep.png')), original)
  }
  assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /\*\*ignored\*\*/)
  write(root, 'packages/image-resources/ignore.json', '[]')
  assert.equal(cli(['--all']).status, 1)
  write(root, 'packages/image-resources/ignore.json', 'invalid json')
  const result = cli(['--all', '--fix'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /Invalid image ignore configuration/)
  assert.deepEqual(fs.readFileSync(path.join(root, 'fixtures/keep.png')), original)
})

it('fix applies candidates, preserves skipped/invalid files and is repeatable', async (t) => {
  const { root, cli } = repository(t)
  const originals = {
    'fix.png': await png(),
    'fix.svg': embedded(await png()),
    'passed.png': await png(true),
    'broken.png': Buffer.from('invalid'),
    'high-depth.png': png16(6),
  }
  for (const [name, data] of Object.entries(originals)) write(root, name, data)
  git(['add', '*.png', '*.svg'], root)
  const result = cli(['--all', '--fix'])
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /2 fixed/)
  assert.match(result.stdout, /visually/)
  for (const name of ['fix.png', 'fix.svg'])
    assert.equal((await inspectImage(name, root)).status, 'passed')
  for (const name of ['passed.png', 'broken.png', 'high-depth.png'] as const)
    assert.deepEqual(fs.readFileSync(path.join(root, name)), originals[name])
  git(['rm', '-f', 'broken.png'], root)
  const before = fs.readFileSync(path.join(root, 'fix.png'))
  for (const args of [[], ['--fix']]) {
    const repeat = cli(['--all', ...args])
    assert.equal(repeat.status, 0, repeat.stderr)
    assert.match(repeat.stdout, /0 fixed/)
    assert.deepEqual(fs.readFileSync(path.join(root, 'fix.png')), before)
  }
  assert.equal(cli([]).status, 2)
})

it('full PR diff selects all directories, renames and earlier commits; fixes selected images', async (t) => {
  const { root, cli } = repository(t)
  write(root, 'untouched.png', await png())
  write(root, 'deleted.png', await png())
  write(root, 'renamed.png', await png(true))
  git(['add', '*.png'], root)
  git(['commit', '-qm', 'base'], root)
  const base = git(['rev-parse', 'HEAD'], root).trim()
  git(['rm', 'deleted.png'], root)
  const unusual = 'web/public/renamed , image\n.png'
  fs.mkdirSync(path.join(root, 'web/public'), { recursive: true })
  git(['mv', 'renamed.png', unusual], root)
  write(root, 'images/docs.png', await png())
  git(['add', 'images', 'web'], root)
  git(['commit', '-qm', 'first'], root)
  write(root, 'api/fixtures/asset.PNG', await png(true))
  write(root, 'logo.png', await png(true))
  write(root, 'web/app/added.svg', embedded(await png()))
  write(root, 'readme.md', 'not an image')
  git(['add', 'api', 'logo.png', 'web', 'readme.md'], root)
  git(['commit', '-qm', 'second'], root)
  assert.deepEqual(imagePaths(base, root), [
    'api/fixtures/asset.PNG',
    'images/docs.png',
    'logo.png',
    'web/app/added.svg',
    unusual,
  ])
  const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path.join(root, 'summary.md') }
  const result = cli(['--base', base], env)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stdout, /::error file=images\/docs.png::/)
  assert.ok(!result.stdout.includes('untouched.png'))
  assert.match(fs.readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /No fixed byte limits/)
  const fixed = cli(['--base', base, '--fix'])
  assert.equal(fixed.status, 0, fixed.stderr)
  assert.match(fixed.stdout, /2 fixed/)
  assert.equal(cli(['--base', base]).status, 0)
  assert.equal(cli(['--all']).status, 1)
})

it('failed atomic replacement retains source bytes and cleans temporary output', async (t) => {
  const { root } = repository(t)
  const original = await png()
  write(root, 'image.png', original)
  git(['add', 'image.png'], root)
  vi.spyOn(fsPromises, 'rename').mockImplementation(async () => {
    throw new Error('Simulated rename failure')
  })
  const logs: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line)
  })
  assert.equal(await main(['--all', '--fix'], root), 1)
  assert.deepEqual(fs.readFileSync(path.join(root, 'image.png')), original)
  assert.equal(
    fs.readdirSync(root).some((name) => name.endsWith('.tmp')),
    false,
  )
  assert.ok(logs.some((line) => line.includes('Unable to write optimized image')))
})
