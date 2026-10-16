// Transpiles classes like Metro does (legacy Hermes has none). node bench/hermes.mjs <bundle.js> <out.js> [passes]
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { BABEL_CORE } = require('../test/harness/paths.cjs')
const babel = require(BABEL_CORE)
const [input, output, passes = '2000'] = process.argv.slice(2)
const { code } = babel.transformSync(fs.readFileSync(input, 'utf8'), {
    babelrc: false,
    configFile: false,
    compact: false,
    plugins: [require.resolve('@babel/plugin-transform-classes'), require.resolve('@babel/plugin-transform-block-scoping')],
})
fs.writeFileSync(output, `globalThis.PASSES = ${passes};\n${code}`)
