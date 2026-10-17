// The private Reanimated fields the adapter reads, checked in each supported version's source.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { REANIMATED } = require('./harness/paths.cjs') as { REANIMATED: Record<string, string> }

const read = (root: string, ...candidates: Array<string>) => {
    const file = candidates.map((c) => path.join(root, c)).find((f) => fs.existsSync(f))
    assert.ok(file, `none of ${candidates.join(', ')}`)
    return fs.readFileSync(file, 'utf8')
}

for (const [line, root] of Object.entries(REANIMATED)) {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version

    test(`react-native-reanimated ${version} (${line}.x): fields the Reanimated check and CSS adapter rely on`, () => {
        const src = path.join(root, 'src')
        const css = read(src, 'css/component/AnimatedComponent.native.tsx', 'css/component/AnimatedComponent.tsx')
        const animated = read(src, 'createAnimatedComponent/AnimatedComponent.native.tsx', 'createAnimatedComponent/AnimatedComponent.tsx')
        const factory = read(src, 'createAnimatedComponent/createAnimatedComponent.tsx')

        assert.match(css, /default:\s*\{\s*collapsable:\s*false\s*\}/, 'renders its child with collapsable: false')
        assert.match(css, /_componentRef\s*=\s*this\._resolveComponentRef\(ref\)/, 'keeps the animated ref in _componentRef')
        assert.match(css, /ref=\{this\._setComponentRef/, 'the ref goes on the child it renders')
        assert.match(css, /_CSSManager\??:\s*CSSManager/)
        assert.match(css, /_cssStyle:\s*CSSStyle/)
        assert.match(animated, /_updateStyles\(props/)
        assert.match(css, /this\._CSSManager\??\.update\(this\._cssStyle/, "CSS base class pushes _cssStyle to the manager")
        assert.match(factory, /static displayName = `AnimatedComponent\(/)
        assert.match(css, /componentWillUnmount\(\)[\s\S]{0,1000}?this\._willUnmount = true/, '_willUnmount marks a hidden or unmounted owner')
        assert.match(css, /this\._willUnmount = false/)
        const transitions = read(src, 'css/native/managers/CSSTransitionsManager.ts')
        assert.match(transitions, /unmountCleanup\(\): void \{\s*\/\/ noop\s*\}/, 'transitions survive componentWillUnmount, so hidden owners can be refreshed')
    })
}
