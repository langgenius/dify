const fs = require('node:fs')
// https://www.npmjs.com/package/uglify-js
const UglifyJS = require('uglify-js')

const { readFileSync, writeFileSync } = fs

writeFileSync('public/embed.min.js', UglifyJS.minify({
  'embed.js': readFileSync('public/embed.js', 'utf8'),
}).code, 'utf8')
