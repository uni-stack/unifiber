// With Metro's inlineRequires (RN's default), an import used inside a function costs a require() per call.
// Transforms src/ like metro-transform-worker and fails on any require() left inside a function.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { ROOT, BABEL_CORE, BABEL_PRESET } = require('./harness/paths.cjs')
const babel = require(BABEL_CORE)
const preset = require(BABEL_PRESET)
const { inlineRequiresPlugin } = require('metro-transform-plugins')
const generateImportNames = require('metro/private/ModuleGraph/worker/generateImportNames').default

const sources = (dir: string): Array<string> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name)
        return entry.isDirectory() ? sources(file) : file.endsWith('.ts') ? [file] : []
    })

const requiresInsideFunctions = (file: string) => {
    const transformed = babel.transformSync(fs.readFileSync(file, 'utf8'), {
        filename: file,
        babelrc: false,
        configFile: false,
        ast: true,
        code: false,
        presets: [[preset, { dev: false }]],
    })
    const { importDefault, importAll } = generateImportNames(transformed.ast)
    const { ast } = babel.transformFromAstSync(transformed.ast, '', {
        filename: file,
        babelrc: false,
        configFile: false,
        ast: true,
        code: false,
        plugins: [[inlineRequiresPlugin, { inlineableCalls: [importDefault, importAll] }]],
    })
    const found: Array<string> = []

    babel.traverse(ast, {
        CallExpression(callPath: any) {
            if (!callPath.get('callee').isIdentifier({ name: 'require' })) {
                return
            }
            const fn = callPath.getFunctionParent()
            if (fn) {
                const name = fn.node.id?.name ?? fn.parentPath?.node?.id?.name ?? fn.parentPath?.node?.key?.name ?? '(anonymous)'
                found.push(`${path.relative(ROOT, file)}: ${name}() requires '${callPath.node.arguments[0]?.value}' on every call`)
            }
        },
    })

    return found
}

test('no src function body pays an inline require (Metro inlineRequires: true, RN default)', () => {
    const violations = sources(path.join(ROOT, 'src')).flatMap(requiresInsideFunctions)

    assert.deepEqual(violations, [])
})
