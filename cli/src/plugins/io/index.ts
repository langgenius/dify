import type { Buffer } from 'node:buffer'
import type { OutputService } from '@/plugins/output'
import type { Style } from '@/sys/io/color'
import type { IOStreams } from '@/sys/io/streams'
import type { Printable, View } from '@/sys/io/view'
import { definePlugin } from '@/kernel/plugin'
import { output, OutputMode } from '@/plugins/output'
import { env } from '@/sys'
import { colorEnabled, colorScheme } from '@/sys/io/color'
import { realStreams } from '@/sys/io/streams'
import { isView } from '@/sys/io/view'

export const Channel = { Out: 'out', Err: 'err' } as const
export type ChannelValue = (typeof Channel)[keyof typeof Channel]

export type IOService<S extends IOStreams = IOStreams> = Readonly<{
  document: (value: Printable | View) => Promise<void>
  emit: (value: Printable | View, channel: ChannelValue) => Promise<void>
  notice: (text: string) => void
  raw: (chunk: string | Buffer) => Promise<void>
  streams: S
}>

const JSON_INDENT = 2
const NEWLINE = '\n'

// Every mode field defaults to json so existing single-argument callers (results,
// streams) keep their pre-view behaviour: a plain Printable is always json anyway.
const JSON_ONLY: OutputService = Object.freeze({ out: OutputMode.Json, err: OutputMode.Json })

const CHANNEL_STREAM: Readonly<Record<ChannelValue, (s: IOStreams) => NodeJS.WritableStream>> = {
  [Channel.Out]: (s) => s.out,
  [Channel.Err]: (s) => s.err,
}
const CHANNEL_TTY: Readonly<Record<ChannelValue, (s: IOStreams) => boolean>> = {
  [Channel.Out]: (s) => s.isOutTTY,
  [Channel.Err]: (s) => s.isErrTTY,
}

// The callback form reports a reader that closed the pipe as a rejection, so
// `printEnvelope` can end the run at exit 0 instead of the write failing silently.
function writeChunk(stream: NodeJS.WritableStream, chunk: string | Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (err) => (err ? reject(err) : resolve()))
  })
}

export function ioService<S extends IOStreams>(
  streams: S,
  mode: OutputService = JSON_ONLY,
): IOService<S> {
  const styles: Readonly<Record<ChannelValue, Style>> = {
    [Channel.Out]: colorScheme(
      mode.out === OutputMode.Text && colorEnabled(CHANNEL_TTY[Channel.Out](streams), env()),
    ),
    [Channel.Err]: colorScheme(
      mode.err === OutputMode.Text && colorEnabled(CHANNEL_TTY[Channel.Err](streams), env()),
    ),
  }
  const emit: IOService['emit'] = (value, channel) => {
    const stream = CHANNEL_STREAM[channel](streams)
    if (mode[channel] === OutputMode.Text && isView(value))
      return writeChunk(stream, `${value.text(styles[channel])}${NEWLINE}`)
    const json = isView(value) ? value.json : value
    return writeChunk(stream, `${JSON.stringify(json, null, JSON_INDENT)}${NEWLINE}`)
  }
  return Object.freeze({
    document: (value) => emit(value, Channel.Out),
    emit,
    notice: (text) => {
      streams.err.write(`${text}${NEWLINE}`)
    },
    raw: (chunk) => writeChunk(streams.out, chunk),
    streams,
  })
}

export const io = definePlugin({
  name: 'io',
  needs: [output],
  build: async (ctx): Promise<IOService> => ioService(realStreams(), await ctx.get(output)),
})
