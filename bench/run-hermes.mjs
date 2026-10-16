// esbuild bundle -> class transform -> Hermes. HERMES must be the VM binary (hermes, not hermesc).
// HERMES=/path/to/hermes node bench/run-hermes.mjs <bench/entry.ts> [passes]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [entry, passes = '400'] = process.argv.slice(2)
const hermes = process.env.HERMES

if (!entry || !hermes || !fs.existsSync(hermes)) {
    console.error('usage: HERMES=/path/to/hermes node bench/run-hermes.mjs <bench/entry.ts> [passes]')
    process.exit(1)
}

const here = import.meta.dirname
const name = path.basename(entry, '.ts')
const outDir = path.join(here, 'out')
const bundle = path.join(outDir, `${name}.js`)
const hermesBundle = path.join(outDir, `${name}-hermes.js`)

fs.mkdirSync(outDir, { recursive: true })
execFileSync(process.execPath, [path.join(here, 'build.mjs'), entry, bundle], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(here, 'hermes.mjs'), bundle, hermesBundle, passes], { stdio: 'inherit' })
execFileSync(hermes, ['-O', '-w', hermesBundle], { stdio: 'inherit' })
