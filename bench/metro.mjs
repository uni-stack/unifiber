// A bench entry built like an app ships (Metro, RN's default config, inline requires), run on Hermes.
// HERMES=/path/to/hermes node bench/metro.mjs <bench/entry.ts> [passes] [--no-inline-requires]
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ROOT, RN, SCHEDULER } = require('../test/harness/paths.cjs')
const Metro = require('metro')
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config')

const args = process.argv.slice(2)
const inlineRequires = !args.includes('--no-inline-requires')
const [entry, passes = '400'] = args.filter((a) => !a.startsWith('--'))
const hermes = process.env.HERMES

if (!entry || !hermes || !fs.existsSync(hermes)) {
    console.error('usage: HERMES=/path/to/hermes node bench/metro.mjs <bench/entry.ts> [passes] [--no-inline-requires]')
    process.exit(1)
}

const outDir = path.join(ROOT, 'bench', 'out')
const stubDir = path.join(outDir, 'metro-stubs')
fs.mkdirSync(stubDir, { recursive: true })
fs.writeFileSync(path.join(stubDir, 'private-interface.js'), 'module.exports = globalThis.__unifiberPrivateInterface\n')
fs.writeFileSync(path.join(stubDir, 'empty.js'), 'module.exports = {}\n')
fs.writeFileSync(path.join(stubDir, 'passes.js'), `globalThis.PASSES = ${Number(passes)}\n`)

const aliases = {
    'react-native-renderer': path.join(RN, 'Libraries', 'Renderer', 'implementations', 'ReactFabric-prod.js'),
    scheduler: path.join(SCHEDULER, 'cjs', 'scheduler-unstable_mock.production.js'),
    'react-native/Libraries/ReactPrivate/ReactNativePrivateInterface': path.join(stubDir, 'private-interface.js'),
    'react-native/Libraries/ReactPrivate/ReactNativePrivateInitializeCore': path.join(stubDir, 'empty.js'),
    'react-native/react-private-interface': path.join(stubDir, 'private-interface.js'),
    'react-native/setup-env': path.join(stubDir, 'empty.js'),
}

const config = mergeConfig(await getDefaultConfig(ROOT), {
    projectRoot: ROOT,
    watchFolders: [ROOT],
    cacheStores: [],
    resolver: {
        sourceExts: ['ts', 'tsx', 'js', 'cjs', 'json'],
        resolveRequest: (context, moduleName, platform) =>
            aliases[moduleName] ? { type: 'sourceFile', filePath: aliases[moduleName] } : context.resolveRequest(context, moduleName, platform),
    },
    serializer: { getModulesRunBeforeMainModule: () => [], getPolyfills: () => [path.join(stubDir, 'passes.js')] },
    transformer: { getTransformOptions: async () => ({ transform: { experimentalImportSupport: false, inlineRequires } }) },
})

const name = `${path.basename(entry, '.ts')}${inlineRequires ? '' : '-no-inline'}`
const bundle = path.join(outDir, `${name}.metro.js`)

await Metro.runBuild(config, { entry: path.resolve(entry), out: bundle, platform: 'ios', dev: false, minify: true })
execFileSync(hermes, ['-O', '-w', bundle], { stdio: 'inherit' })
