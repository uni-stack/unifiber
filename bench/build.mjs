// esbuild bundle of a bench entry with the production renderer. Imports are hoisted: use metro.mjs for app numbers.
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ESBUILD, RN, REACT, SCHEDULER } = require('../test/harness/paths.cjs')
const esbuild = require(ESBUILD)
const map = {
    react: path.join(REACT, 'cjs', 'react.production.js'),
    scheduler: path.join(SCHEDULER, 'cjs', 'scheduler-unstable_mock.production.js'),
    'react-native-renderer': path.join(RN, 'Libraries', 'Renderer', 'implementations', 'ReactFabric-prod.js'),
}
const [entry, out] = process.argv.slice(2)
await esbuild.build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'iife',
    target: 'es2019', // Hermes: no class fields / ?? lowering issues
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
    plugins: [{
        name: 'rn',
        setup(build) {
            build.onResolve({ filter: /^(react|scheduler|react-native-renderer)$/ }, (a) => ({ path: map[a.path] }))
            build.onResolve({ filter: /(ReactNativePrivateInterface|react-native\/react-private-interface)$/ }, () => ({ path: 'pi', namespace: 'stub' }))
            build.onResolve({ filter: /(ReactNativePrivateInitializeCore|react-native\/setup-env)$/ }, () => ({ path: 'init', namespace: 'stub' }))
            build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
                contents: a.path === 'pi' ? 'module.exports = globalThis.__unifiberPrivateInterface' : '',
                loader: 'js',
            }))
        },
    }],
    logLevel: 'warning',
})
