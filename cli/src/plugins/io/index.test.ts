import { expect, it } from 'vite-plus/test'
import { OutputMode } from '@/plugins/output'
import { bufferStreams } from '@/sys/io/streams'
import { view } from '@/sys/io/view'
import { Channel, ioService } from './index'

const both = (mode: 'json' | 'text') => ({ out: mode, err: mode }) as const

it('emits the text form on a text channel and json elsewhere', async () => {
  const text = ioService(bufferStreams(), both(OutputMode.Text))
  await text.emit(
    view({ a: 1 }, () => 'A is one'),
    Channel.Out,
  )
  expect(text.streams.outBuf()).toBe('A is one\n')

  const json = ioService(bufferStreams(), both(OutputMode.Json))
  await json.emit(
    view({ a: 1 }, () => 'A is one'),
    Channel.Out,
  )
  expect(JSON.parse(json.streams.outBuf())).toEqual({ a: 1 })
})

it('a plain printable is json in every mode', async () => {
  const text = ioService(bufferStreams(), both(OutputMode.Text))
  await text.emit({ a: 1 }, Channel.Err)
  expect(JSON.parse(text.streams.errBuf())).toEqual({ a: 1 })
})

it('document is emit on stdout', async () => {
  const text = ioService(bufferStreams(), both(OutputMode.Text))
  await text.document(view([1], () => 'one'))
  expect(text.streams.outBuf()).toBe('one\n')
})
