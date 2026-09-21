import { crc32, deflateSync, inflateSync } from 'node:zlib'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import sharp from 'sharp'
import { optimize } from 'svgo'

const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex')
const xmlNamespace = 'http://www.w3.org/XML/1998/namespace'
const xlinkNamespace = 'http://www.w3.org/1999/xlink'
// Never enable preset-default: preserve geometry, styles, IDs and definitions.
const svgConfig = { plugins: ['removeComments', 'sortAttrs'], js2svg: { pretty: false } }

export function pngChunks(data) {
  if (!data.subarray(0, 8).equals(pngSignature)) throw new Error('Invalid PNG signature')
  const chunks = []
  let offset = 8
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset)
    const end = offset + length + 12
    if (end > data.length) throw new Error('Truncated PNG chunk')
    const type = data.toString('ascii', offset + 4, offset + 8)
    if (crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4))
      throw new Error(`Invalid PNG ${type} checksum`)
    chunks.push({
      type,
      data: data.subarray(offset + 8, end - 4),
      bytes: data.subarray(offset, end),
    })
    offset = end
    if (type === 'IEND') break
  }
  if (
    chunks[0]?.type !== 'IHDR' ||
    chunks[0].data.length !== 13 ||
    chunks.at(-1)?.type !== 'IEND' ||
    offset !== data.length
  )
    throw new Error('Invalid PNG chunk structure')
  return chunks
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12)
  chunk.writeUInt32BE(data.length)
  chunk.write(type, 4, 4, 'ascii')
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4)
  return chunk
}

export async function compressRaster(data) {
  if (data.subarray(0, 8).equals(pngSignature)) {
    const chunks = pngChunks(data)
    if (chunks.some((chunk) => chunk.type === 'acTL'))
      return { data, method: 'skipped: animated/multi-frame image' }
    if (chunks[0].data[8] === 16)
      return { data, method: 'skipped: 16-bit PNG (preserve source precision)' }
    // Decode for validation only. Never re-encode pixels or colour metadata.
    const input = sharp(data, { failOn: 'warning' })
    const metadata = await input.metadata()
    await input.stats()
    const stream = Buffer.concat(
      chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data),
    )
    const raw = inflateSync(stream, {
      maxOutputLength: metadata.width * metadata.height * 8 + 1024,
    })
    const compressed = deflateSync(raw, { level: 9 })
    let inserted = false
    const output = chunks.flatMap((chunk) => {
      if (chunk.type !== 'IDAT') return [chunk.bytes]
      if (inserted) return []
      inserted = true
      return [pngChunk('IDAT', compressed)]
    })
    return {
      data: Buffer.concat([pngSignature, ...output]),
      method: 'PNG lossless IDAT recompression',
    }
  }
  // libvips does not decode these legacy formats; leave them explicitly skipped.
  if (
    data.subarray(0, 2).toString() === 'BM' ||
    data.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
  )
    return { data, method: 'skipped: no optimizer for BMP/ICO' }
  const input = sharp(data, { failOn: 'warning' })
  const metadata = await input.metadata()
  if ((metadata.pages ?? 1) !== 1) return { data, method: 'skipped: animated/multi-frame image' }
  if (!['jpeg', 'webp'].includes(metadata.format))
    return { data, method: `skipped: no optimizer for ${metadata.format}` }
  // Preserve ICC/EXIF (including orientation), XMP, and density. Do not auto-rotate.
  let pipeline = input.keepMetadata()
  if (metadata.density) pipeline = pipeline.withDensity(metadata.density)
  const candidate =
    metadata.format === 'jpeg'
      ? await pipeline.jpeg({ quality: 90, progressive: true }).toBuffer()
      : await pipeline.webp({ quality: 90, effort: 6 }).toBuffer()
  return {
    data: candidate,
    method: `${metadata.format.toUpperCase()} quality 90 (lossy; visual review required)`,
  }
}

export function parseSvg(data) {
  const document = new DOMParser({
    onError: (_level, message) => {
      throw new Error(message)
    },
  }).parseFromString(data.toString('utf8'), 'image/svg+xml')
  if (document.documentElement?.localName !== 'svg') throw new Error('Expected an SVG root element')
  return document
}

function decodePayload(header, payload) {
  // Percent escapes represent bytes, including arbitrary binary data URLs.
  const bytes = []
  for (let i = 0; i < payload.length; i++) {
    if (payload[i] === '%' && /^[\da-f]{2}$/i.test(payload.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(payload.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      bytes.push(...Buffer.from(payload[i]))
    }
  }
  const data = Buffer.from(bytes)
  if (!header.toLowerCase().includes(';base64')) return data
  const text = data.toString('ascii').replace(/\s/g, '')
  if (
    data.some((byte) => byte > 127) ||
    !/^(?:[A-Z\d+/]{4})*(?:[A-Z\d+/]{2}==|[A-Z\d+/]{3}=)?$/i.test(text)
  )
    throw new Error('Invalid embedded Base64 image')
  return Buffer.from(text, 'base64')
}

export async function compressSvg(data) {
  const document = parseSvg(data)
  const elements = Array.from(document.getElementsByTagName('*'))
  // Guard before SVGO parsing: its whitespace trimming is not plugin-controlled.
  if (
    elements.some(
      (element) =>
        ['text', 'tspan', 'textPath', 'foreignObject'].includes(element.localName) ||
        element.getAttributeNS(xmlNamespace, 'space') === 'preserve',
    )
  ) {
    return {
      data,
      method: 'skipped: SVG contains whitespace-sensitive content; preserve original bytes',
    }
  }
  const methods = ['SVGO conservative optimization']
  for (const element of elements) {
    if (element.localName !== 'image') continue
    const attribute =
      element.getAttributeNode('href') ?? element.getAttributeNodeNS(xlinkNamespace, 'href')
    if (!attribute) continue
    const comma = attribute.value.indexOf(',')
    if (comma < 0) continue
    const header = attribute.value.slice(0, comma)
    if (
      !header.toLowerCase().startsWith('data:image/') ||
      header.toLowerCase().split(';')[0] === 'data:image/svg+xml'
    )
      continue
    const original = decodePayload(header, attribute.value.slice(comma + 1))
    const candidate = await compressRaster(original)
    if (candidate.method.startsWith('skipped:')) methods.push(`embedded ${candidate.method}`)
    if (candidate.data.length < original.length) {
      // Attribute updates handle XML entities and normalized Base64 line breaks.
      attribute.value = `${header.split(';')[0]};base64,${candidate.data.toString('base64')}`
      methods.push(`embedded ${candidate.method}`)
    }
  }
  const serialized = new XMLSerializer().serializeToString(document)
  return {
    data: Buffer.from(optimize(serialized, svgConfig).data),
    method: [...new Set(methods)].join('; '),
  }
}
