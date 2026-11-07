#!/usr/bin/env node
import { main } from '../src/main.js'
import { cancel } from '../src/plugins/commands/cancel.js'

const EPIPE = 'EPIPE'

// SIGINT unwinds the run through the shared controller; the exit code is whatever
// the command settles on, since 130 is outside the frozen taxonomy.
process.once('SIGINT', cancel)

// A reader that closed stdout (`| head`) still emits on the stream after the write
// callback has already reported it. Swallowing only EPIPE keeps that from turning a
// finished run into an unhandled 'error' event.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== EPIPE) throw err
})

void (async () => {
  process.exitCode = await main(process.argv.slice(2))
})()
