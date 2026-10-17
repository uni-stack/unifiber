// A fiber with missing fields gives undefined / null / false for that call, never a throw, and nothing else is affected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as U from '../src/fiber'
import { Fiber, Reanimated, type Host } from '../src/index'

const require = createRequire(import.meta.url)
const { React, render, View } = require('./harness/fabric.cjs')({ mode: process.env.UNIFIBER_MODE ?? 'development' })
const h = React.createElement

const malformed = [
    {},
    { tag: 5 },
    { tag: 5, stateNode: null },
    { tag: 5, stateNode: {} },
    { tag: 5, stateNode: { node: {} } },
    { tag: 5, stateNode: { node: {}, canonical: {} }, return: { tag: 22, memoizedState: {}, return: null } },
]

test('malformed fibers: every query answers without throwing', () => {
    for (const fiber of malformed) {
        const ref = { __internalInstanceHandle: fiber }
        const host = fiber as unknown as Host
        const visited: Array<Host> = []

        assert.equal(Fiber.getHostFor(ref), fiber, 'a ref is resolved without inspecting the fiber')
        assert.doesNotThrow(() => Fiber.getShadowNodeFor(ref))
        assert.equal(Fiber.getNativeTag(host), undefined)
        assert.equal(Fiber.getParentHost(host), undefined)
        assert.equal(Fiber.getHostForInstanceHandle(fiber), undefined)
        assert.doesNotThrow(() => Fiber.getShadowNodes(host))
        assert.doesNotThrow(() => Fiber.isHidden(host))
        assert.equal(Fiber.isMounted(host), false)
        assert.doesNotThrow(() => Fiber.collectVisibleAncestors([host], (x) => visited.push(x)))
        assert.doesNotThrow(() => Fiber.collectAncestors([host], (x) => visited.push(x)))
        assert.deepEqual(visited, [], 'no canonical: nothing to refresh')
        assert.doesNotThrow(() => Fiber.verify(host, { opacity: 1 }))
        assert.deepEqual(Fiber.getOwners(host), [])
        assert.equal(Fiber.patchRenderedProps(host, (props) => props), false)
        assert.equal(Reanimated.animatedComponentOf(host), null)
        assert.equal(U.committedOf(fiber as any), null)
        assert.equal(U.readContext(fiber as any, React.createContext('x'), 'fallback'), 'fallback')
    }

    assert.equal(Fiber.getHostFor(null), undefined)
    assert.equal(Fiber.getHostFor({}), undefined)
    assert.equal(Fiber.getShadowNodeFor(undefined), undefined)
    assert.equal(U.readContextDuringRender(null as any), undefined)
})

test('a malformed fiber switches nothing off: real views keep working afterwards', () => {
    Fiber.getHostFor({ __internalInstanceHandle: { tag: 5, stateNode: {} } })

    let ref: any = null
    render(h(View, null, h(View, { ref: (r: any) => r && (ref = r) })))
    const host = Fiber.getHostFor(ref)!

    assert.equal(typeof Fiber.getShadowNode(host), 'object')
    assert.equal(typeof Fiber.getNativeTag(host), 'number')
    assert.ok(Fiber.getParentHost(host))
    assert.equal(Fiber.isHidden(host), false)
    assert.equal(Fiber.isMounted(host), true)
})
