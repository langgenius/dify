import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})

// Polyfill BroadcastChannel for Jest (Node environment)
const {
  TextDecoder, TextEncoder,
} = require('node:util')

const { ReadableStream, TransformStream } = require('node:stream/web')

const { BroadcastChannel, MessagePort } = require('node:worker_threads')

Object.defineProperties(globalThis, {
  TextDecoder: { value: TextDecoder },
  TextEncoder: { value: TextEncoder },
  ReadableStream: { value: ReadableStream },
  TransformStream: { value: TransformStream },
  BroadcastChannel: { value: BroadcastChannel },
  MessagePort: { value: MessagePort },
})

const {
  Blob, File,

} = require('node:buffer')
// const {
//   fetch, Headers, FormData, Request, Response,

// } = require('undici')

Object.assign(globalThis, {
  // fetch,
  // Headers,
  // FormData,
  // Request,
  // Response,
  Blob,
  File,
})
