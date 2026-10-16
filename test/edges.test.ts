// Rare branches: committedOf's slow-path cases on hand-built fiber pairs, detached fibers, adapter and registry guards.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as U from '../src/fiber'
import { Fiber, Reanimated, type Host } from '../src/index'
import { createOwnerRegistry, type OwnerAdapter, type StyleSource } from '../src/adapters/registry'

const require = createRequire(import.meta.url)
const mode = process.env.UNIFIBER_MODE ?? 'development'
const { React, render, act, View } = require('./harness/fabric.cjs')({ mode })
const h = React.createElement
const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))

type F = { tag: number; return: F | null; alternate: F | null; child: F | null; sibling: F | null; stateNode: any }
const fiber = (tag = 5): F => ({ tag, return: null, alternate: null, child: null, sibling: null, stateNode: null })
const pair = (tag = 5): [F, F] => {
    const a = fiber(tag)
    const b = fiber(tag)
    a.alternate = b
    b.alternate = a
    return [a, b]
}
const root = (): F => {
    const r = fiber(U.Tag.HostRoot)
    r.stateNode = { current: r }
    return r
}
const committedOf = (f: F) => U.committedOf(f as any) as unknown as F | null

test('committedOf: a parent that never re-rendered (no alternate) is skipped, like React', () => {
    const r = root()
    const parent = fiber(0)
    const [a, b] = pair()
    parent.return = r
    r.child = parent
    a.return = parent
    b.return = parent
    parent.child = a

    assert.equal(committedOf(a), a)
    assert.equal(committedOf(b), b)
})

test('committedOf: detached (no HostRoot at the top) or inconsistent pairs answer null, where React throws', () => {
    // walks off the top without meeting a HostRoot
    const [a, b] = pair()
    const orphanParent = fiber(0)
    a.return = orphanParent
    b.return = orphanParent
    assert.equal(committedOf(a), null)

    // parents that aren't each other's alternate
    const r = root()
    const [pa, pb] = pair(0)
    const stranger = fiber(0)
    pa.return = r
    pb.return = r
    const [x, y] = pair()
    x.return = pa
    y.return = stranger
    stranger.alternate = fiber(0)
    pa.child = x
    stranger.child = y
    assert.equal(committedOf(x), null)

    // parents share a child list that holds neither fiber
    const [sa, sb] = pair(0)
    const shared = fiber()
    sa.child = shared
    sb.child = shared
    const [c, d] = pair()
    c.return = sa
    d.return = sb
    assert.equal(committedOf(c), null)

    // same return pointer, but neither parent lists either child
    const [qa, qb] = pair(0)
    const [e, f] = pair()
    e.return = qa
    f.return = qa
    qa.child = fiber()
    qb.child = fiber()
    assert.equal(committedOf(e), null)
})

test('committedOf on real fibers: unmounted views answer null, mounted ones the committed half', () => {
    let ref: any = null
    const app = (show: boolean, n: number) => h(View, { testID: `r${n}` }, show ? h(View, { ref: (r: any) => r && (ref = r), style: { opacity: n } }) : null)
    const tag = render(app(true, 1))
    rerender(app(true, 2), tag)
    const creation = ref.__internalInstanceHandle

    assert.equal((U.committedOf(creation) as any).memoizedProps.style.opacity, 2)
    rerender(app(false, 3), tag)
    assert.equal(U.committedOf(creation), null)
    assert.equal(Fiber.getNativeTag(creation as Host), undefined)
    assert.equal(Fiber.isHidden(creation as Host), false)
})

test('getShadowNodes: two revisions only while a render is in flight; one shared node once committed', () => {
    let ref: any = null
    const during: Array<number> = []
    // renders after the first view completed: its work-in-progress half holds a new node
    const Probe = ({ n }: any) => {
        if (ref && n > 0) during.push(Fiber.getShadowNodes(Fiber.getHostFor(ref)!).length)
        return null
    }
    const app = (n: number) => h(View, null, h(View, { ref: (r: any) => r && (ref = r), style: { opacity: n } }), h(Probe, { n }))
    const tag = render(app(0))

    for (let n = 1; n <= 3; n++) {
        rerender(app(n), tag)
        assert.equal(Fiber.getShadowNodes(Fiber.getHostFor(ref)!).length, 1)
    }
    assert.deepEqual(during, [2, 2, 2], 'mid-render: the committed node and the one React is about to commit')
})

test('Reanimated.animatedComponentOf: a collapsable={false} view no ref ever attached to is not claimed', () => {
    let parent: any = null
    render(h(View, { ref: (r: any) => r && (parent = r) }, h(View, { collapsable: false })))
    const child = U.firstHostBelow((parent.__internalInstanceHandle as any).child)

    assert.equal((child as any).memoizedProps.collapsable, false)
    assert.equal(Reanimated.animatedComponentOf(child as unknown as Host), null)
})

test('cssAdapter guards: not mounted yet (no CSS manager) and styles that aren\'t the source\'s', () => {
    const calls: Array<string> = []
    const owner: any = {
        _cssStyle: { transitionProperty: ['backgroundColor'], backgroundColor: 'white' },
        _updateStyles(props: any) {
            calls.push('original')
            this._cssStyle = { ...props.style }
        },
        shouldComponentUpdate: () => true,
        props: { style: { transitionProperty: ['backgroundColor'], backgroundColor: 'white' } },
        _reactInternals: null,
    }
    const source: StyleSource = { name: 's', epoch: () => 0, resolve: () => undefined }

    Reanimated.cssAdapter.attach(owner, source)
    Reanimated.cssAdapter.attach(owner, source) // idempotent
    assert.doesNotThrow(() => Reanimated.cssAdapter.refresh(owner, source))
    owner._updateStyles(owner.props)
    assert.equal(owner._cssStyle.backgroundColor, 'white')
    assert.deepEqual(calls, ['original'])
})

test('registry guards: null hosts, hidden fibers, an adapter switched off on the refresh path', () => {
    const seen: Array<string> = []
    const adapter: OwnerAdapter<object> = {
        name: 'probe',
        gate: () => true,
        claim: () => {
            seen.push('claim')
            throw new Error('field moved')
        },
        attach: () => {},
        refresh: () => {},
    }
    const errors: Array<string> = []
    const registry = createOwnerRegistry({ name: 's', epoch: () => 0, resolve: () => undefined }, [adapter], (reason) => errors.push(reason))
    let ref: any = null
    render(h(React.Suspense, { fallback: null }, h(View, { ref: (r: any) => r && (ref = r) })))
    const fiberOfView = Fiber.getHostFor(ref)

    registry.link(null)
    registry.refresh([null])
    registry.refresh([fiberOfView]) // throws inside claim: switched off, reported once
    registry.refresh([fiberOfView]) // gate passes, but the adapter is off
    registry.link(fiberOfView)

    assert.deepEqual(seen, ['claim'])
    assert.equal(errors.length, 1)
    assert.match(errors[0], /probe failed: Error: field moved/)
})

test('committedOf: an asymmetric pair under a shared parent answers null (React throws)', () => {
    const [qa, qb] = pair(0)
    qb.alternate = fiber(0) // qa -> qb, but qb no longer points back
    const [x, y] = pair()
    x.return = qa
    y.return = qa
    qa.child = fiber()
    qb.child = x
    assert.equal(committedOf(x), null)
})

test('readContext: a detached provider whose halves disagree reads the half the walk reached', () => {
    const Ctx = React.createContext('default')
    const [pa, pb] = pair(U.Tag.ContextProvider) as Array<any>
    pa.type = Ctx
    pb.type = Ctx
    pa.memoizedProps = { value: 'reached' }
    pb.memoizedProps = { value: 'other' }
    const leaf: any = fiber()
    leaf.return = pa
    assert.equal(U.readContext(leaf, Ctx), 'reached')
})

test('refs that resolve to nothing: plain objects, composites with no host, a scroll ref exposing only getNativeScrollRef', () => {
    let inner: any = null
    let empty: any = null
    class Empty extends React.Component {
        render() {
            return null
        }
    }
    render(h(View, null, h(View, { ref: (r: any) => r && (inner = r) }), h(Empty, { ref: (r: any) => r && (empty = r) })))

    assert.equal(Fiber.getHostFor({}), undefined)
    assert.equal(Fiber.getHostFor(null), undefined)
    assert.equal(Fiber.getHostFor(empty), undefined, 'a class that renders no host')
    assert.equal(Fiber.getContentContainerFor({}), undefined)
    // scroll components exposing only getNativeScrollRef
    assert.equal(Fiber.getHostFor({ getNativeScrollRef: () => inner }), Fiber.getHostFor(inner))
})

test('collectVisibleAncestors skips missing hosts (collected / unmounted handles from C++)', () => {
    let ref: any = null
    render(h(View, null, h(View, { ref: (r: any) => r && (ref = r) })))
    const visited: Array<unknown> = []
    Fiber.collectVisibleAncestors([undefined, null, Fiber.getHostForInstanceHandle(null), Fiber.getHostFor(ref)], (x) => visited.push(x))
    assert.equal(visited.length, 2, 'the view and its parent')
})

test('verify on an unmounted view reads the half it holds', () => {
    let ref: any = null
    const app = (show: boolean, n: number) => h(View, { testID: `r${n}` }, show ? h(View, { ref: (r: any) => r && (ref = r), style: { opacity: n } }) : null)
    const tag = render(app(true, 1))
    rerender(app(true, 2), tag)
    const host = Fiber.getHostFor(ref)!
    rerender(app(false, 3), tag)
    assert.deepEqual(Fiber.verify(host, {}), [])
    assert.equal(Fiber.verify(host, { opacity: 99 }).length, 1)
})

test('getOwners: names through forwardRef, memo and displayName (dev)', () => {
    let ref: any = null
    const Inner = React.forwardRef(function InnerRender(props: any, forwarded: any) {
        return h(View, { ...props, ref: forwarded })
    })
    const Named = (props: any) => h(Inner, props)
    Named.displayName = 'NamedCard'
    const Memo = React.memo(function MemoCard(props: any) {
        return h(Named, props)
    })
    render(h(Memo, { ref: (r: any) => r && (ref = r) }))
    const owners = Fiber.getOwners(Fiber.getHostFor(ref)!)

    if (mode === 'development') {
        assert.deepEqual(owners.slice(0, 4), ['View', 'InnerRender', 'NamedCard', 'MemoCard'])
    } else {
        assert.deepEqual(owners, [])
    }
})
