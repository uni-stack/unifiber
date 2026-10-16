// The fiber shapes unifiber reads, pinned against the renderer react-native ships.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as U from '../src/fiber'
import { Fiber, type Host } from '../src/index'

const require = createRequire(import.meta.url)
const mode = process.env.UNIFIBER_MODE ?? 'development'
const { React, render, act, View, ops, rnVersion, reactVersion } = require('./harness/fabric.cjs')({ mode })
const h = React.createElement
const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))

console.log(`# React ${reactVersion}, RN ${rnVersion}, ${mode}`)

const capture = () => {
    const box: { current: any } = { current: null }
    const ref = (r: any) => {
        box.current = r
    }
    return [box, ref] as const
}

test('host ref -> fiber -> shadow node', () => {
    const [box, ref] = capture()
    render(h(View, { ref, style: { flex: 1 } }))
    const fiber = U.hostFiberOf(box.current)

    assert.ok(fiber)
    assert.equal((fiber as any).tag, U.Tag.HostComponent)
    assert.equal(typeof Fiber.getShadowNode(fiber as unknown as Host), 'object')
    assert.equal(typeof Fiber.getNativeTag(fiber as unknown as Host), 'number')
    assert.equal(box.current.__nativeTag, Fiber.getNativeTag(fiber as unknown as Host))
    assert.deepEqual(Fiber.getShadowNodes(fiber as unknown as Host), [Fiber.getShadowNode(fiber as unknown as Host)], 'one revision before any re-render')
})

test('fibers are sealed in development: no expandos, side tables only', () => {
    const [box, ref] = capture()
    render(h(View, { ref }))
    const fiber = box.current.__internalInstanceHandle

    assert.equal(Object.isExtensible(fiber), mode !== 'development')
})

test('__internalInstanceHandle stays the creation fiber while the committed one alternates', () => {
    const [box, ref] = capture()
    const tag = render(h(View, { ref, style: { opacity: 1 } }))
    const handle = box.current.__internalInstanceHandle
    const seen = new Set()

    for (let i = 2; i < 6; i++) {
        rerender(h(View, { ref, style: { opacity: i / 10 } }), tag)
        assert.equal(box.current.__internalInstanceHandle, handle)

        const committed = U.committedOf(handle) as any

        seen.add(committed)
        assert.equal(committed.memoizedProps.style.opacity, i / 10, 'committedOf returns the fiber with the latest props')
        assert.equal(handle.stateNode.canonical, handle.alternate.stateNode.canonical)
        assert.equal(handle.stateNode.canonical.currentProps, committed.memoizedProps)
        const nodes = Fiber.getShadowNodes(handle)
        assert.ok(nodes.length >= 1 && nodes.length <= 2 && nodes.includes(committed.stateNode.node))
    }

    assert.equal(seen.size, 2, 'the committed fiber flips between the pair')
})

test('class component instance -> fiber via _reactInternals', () => {
    let instance: any
    class Owner extends React.Component {
        constructor(props: any) {
            super(props)
            instance = this
        }
        render() {
            return h(View, { collapsable: false })
        }
    }
    render(h(Owner))
    const fiber = U.fiberOfInstance(instance) as any

    assert.equal(fiber.tag, U.Tag.ClassComponent)
    assert.equal(fiber.stateNode, instance)
})

test('host -> parent host crosses function components; props of either half', () => {
    let owner: any
    const [box, ref] = capture()
    const RNView = (props: any) => h(View, props)
    const UnistylesView = (props: any) => h(RNView, props)
    class AnimatedComponent extends React.Component<any> {
        constructor(props: any) {
            super(props)
            owner = this
        }
        render() {
            return h(UnistylesView, { ...this.props, collapsable: false })
        }
    }
    render(h(View, null, h(AnimatedComponent, { ref: undefined, testID: 'a' }, h(View, { ref }))))
    const outer = U.hostFiberOf(box.current)

    const animatedHost = U.hostAncestor(outer)

    assert.equal((animatedHost as any)?.memoizedProps?.collapsable, false)
    assert.equal(Fiber.getParentHost(outer as unknown as Host), animatedHost)
    assert.ok(U.hostAncestor(outer, 2), 'two hosts up: the outer View')
    assert.equal(U.hostAncestor(outer, 3), null, 'nothing above the root view')
    assert.ok(owner)
})

test('context: <Ctx> and <Ctx.Provider> are the same provider fiber in React 19', () => {
    const Ctx = React.createContext(null)
    const [a, refA] = capture()
    const [b, refB] = capture()
    render(h(View, null, h(Ctx, { value: { name: 'dark' } }, h(View, { ref: refA })), h(Ctx.Provider, { value: { name: 'light' } }, h(View, { ref: refB }))))

    assert.equal(Ctx.Provider, Ctx)
    assert.deepEqual(U.readContext(U.hostFiberOf(a.current), Ctx), { name: 'dark' })
    assert.deepEqual(U.readContext(U.hostFiberOf(b.current), Ctx), { name: 'light' })
    assert.equal(U.readContext(U.hostFiberOf(a.current), React.createContext(null)), undefined)
})

test('Suspense fallback hides the primary subtree (Suspense 13 + Offscreen 22 memoizedState)', () => {
    const [box, ref] = capture()
    const pending = { then() {} }
    const Gate = ({ suspend }: any) => {
        if (suspend) throw pending
        return h(View, { ref })
    }
    const tag = render(h(React.Suspense, { fallback: null }, h(Gate, { suspend: false })))
    const fiber = U.hostFiberOf(box.current)

    assert.equal(Fiber.isHidden(fiber as unknown as Host), false)
    rerender(h(React.Suspense, { fallback: null }, h(Gate, { suspend: true })), tag)
    assert.equal(Fiber.isHidden(fiber as unknown as Host), true, 'react-freeze and freezeOnBlur go through here')
})

test('Activity hidden: Activity 31 -> Offscreen 22 with memoizedState', () => {
    const [box, ref] = capture()
    const tag = render(h(React.Activity, { mode: 'visible' }, h(View, { ref })))
    const fiber = U.hostFiberOf(box.current)
    const parent = (fiber as any).return.return // RCTView <- View (function) <- Offscreen

    assert.equal(parent.tag, U.Tag.Offscreen)
    assert.equal(parent.return.tag, U.Tag.Activity)
    assert.equal(Fiber.isHidden(fiber as unknown as Host), false)

    rerender(h(React.Activity, { mode: 'hidden' }, h(View, { ref })), tag)
    assert.equal(Fiber.isInHiddenActivity(fiber as unknown as Host), true)
})

test('batched refresh: visible host chains, deduped, hidden skipped', () => {
    const refs: Array<any> = []
    const ref = (i: number) => (r: any) => {
        refs[i] = r
    }
    const pending = { then() {} }
    const Frozen = () => {
        throw pending
    }
    render(
        h(View, { testID: 'root' },
            h(View, { ref: ref(0) }),
            h(View, { ref: ref(1) }),
            h(React.Suspense, { fallback: null }, h(View, { ref: ref(2) }), h(Frozen))),
    )
    const visited: Array<string | undefined> = []

    Fiber.collectVisibleAncestors(refs.map((r) => Fiber.getHostFor(r)), (host) => visited.push((host as any).memoizedProps?.testID ?? 'leaf'))

    assert.deepEqual(visited, ['leaf', 'root', 'leaf'])
})

test('Uniwind baseline: React diffs against memoizedProps, patching both keeps the bailout', () => {
    const [box, ref] = capture()
    const stale = { backgroundColor: 'white' }
    const fresh = { backgroundColor: 'black' }
    const Leaf = ({ style }: any) => h(View, { ref, style })
    const tag = render(h(Leaf, { style: stale }))

    rerender(h(Leaf, { style: stale }), tag)

    U.patchRenderedProps(U.hostFiberOf(box.current), (props) => ({ ...props, style: fresh }))
    ops.length = 0
    rerender(h(Leaf, { style: fresh }), tag)

    assert.deepEqual(ops.filter((o: any) => o.payload?.style), [], 'no clone: React saw no diff against the patched baseline')

    rerender(h(Leaf, { style: stale }), tag)
    assert.deepEqual(ops.at(-1).payload.style, stale)
})

test('render-phase context: Fabric is a secondary renderer, the stack is _currentValue2', () => {
    const Ctx = React.createContext('default')
    const seen: Array<string> = []
    class Reader extends React.Component<any> {
        shouldComponentUpdate() {
            seen.push(U.readContextDuringRender(Ctx) as string)
            return true
        }
        render() {
            return h(View)
        }
    }
    const app = (value: string) => h(Ctx, { value }, h(Reader, { n: value }))
    const tag = render(app('a'))
    for (const value of ['b', 'c', 'd']) rerender(app(value), tag)

    assert.deepEqual(seen, ['b', 'c', 'd'])
    assert.equal(U.readContextDuringRender(Ctx), 'default', 'outside render: default value')
})
