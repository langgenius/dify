import { readFileSync, writeFileSync } from 'node:fs'
// https://www.npmjs.com/package/uglify-js
import UglifyJS from 'uglify-js'

writeFileSync('public/embed.min.js', UglifyJS.minify({
  'embed.js': readFileSync('public/embed.js', 'utf8'),
}).code, 'utf8')
