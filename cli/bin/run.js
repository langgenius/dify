#!/usr/bin/env node

import { commandTree } from '../dist/commands/tree.js'
import { run } from '../dist/framework/run.js'

await run(commandTree, process.argv.slice(2))
