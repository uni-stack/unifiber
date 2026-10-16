import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Fiber } from '../src/index'

const require = createRequire(import.meta.url)
const mode = process.env.UNIFIBER_MODE ?? 'development'
const { React, render, act, View } = require('./harness/fabric.cjs')({ mode })
const h = React.createElement
const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))

// RN 0.87 ScrollView shape (ScrollView.js:1281)
class ScrollView extends React.Component<any> {
    _inner: any = null
    _native: any = null
    setInner = (r: any) => {
        this._inner = r
    }
    setNative = (r: any) => {
        if (r) {
            this._native = Object.assign(r, {
                getScrollResponder: () => this._native,
                getNativeScrollRef: () => this._native,
                getInnerViewRef: () => this._inner,
            })
        }
        this.props.forwardedRef?.(this._native)
    }
    render() {
        // iOS: refreshControl is the scroll host's first child (ScrollView.js:1925-1933)
        return h('RCTScrollView', { ref: this.setNative },
            this.props.refreshControl ? h('RCTRefreshControl') : null,
            h('RCTScrollContentView', { ref: this.setInner, testID: 'content' }, this.props.children))
    }
}
class FlatList extends React.Component<any> {
    _scroll: any = null
    getScrollResponder() {
        return this._scroll
    }
    getNativeScrollRef() {
        return this._scroll
    }
    render() {
        return h(ScrollView, { refreshControl: this.props.refreshControl, forwardedRef: (r: any) => (this._scroll = r) })
    }
}

test('getContentContainerFor: ScrollView and FlatList refs, with and without refreshControl', () => {
    for (const refreshControl of [false, true]) {
        let scroll: any = null
        let list: any = null
        render(h(View, null,
            h(ScrollView, { refreshControl, forwardedRef: (r: any) => r && (scroll = r) }),
            h(FlatList, { refreshControl, ref: (r: any) => r && (list = r) })))

        for (const ref of [scroll, list]) {
            const content = Fiber.getContentContainerFor(ref)!
            assert.ok(content, `found for ${ref.constructor.name}, refreshControl ${refreshControl}`)
            assert.equal((content as any).type, 'RCTScrollContentView')
            assert.equal(Fiber.getParentHost(content), Fiber.getHostFor(ref.getNativeScrollRef?.() ?? ref))
        }
    }
})

test('verify: a native-only update React would revert, until the baseline is patched', () => {
    let instance: any = null
    const style = { backgroundColor: 'white', padding: 4 }
    const app = (n: number) => h(View, { testID: `root-${n}` }, h(View, { ref: (r: any) => r && (instance = r), style: [style, null] }))
    const tag = render(app(0))
    const host = Fiber.getHostFor(instance)!

    assert.deepEqual(Fiber.verify(host, { backgroundColor: 'white' }), [])
    assert.deepEqual(Fiber.verify(host, { backgroundColor: 'black' }), [{ key: 'backgroundColor', react: 'white', expected: 'black' }])

    Fiber.patchRenderedProps(host, (props) => ({ ...props, style: [{ ...style, backgroundColor: 'black' }] }))
    assert.deepEqual(Fiber.verify(host, { backgroundColor: 'black', padding: 4 }), [])
    for (let n = 1; n <= 3; n++) {
        rerender(app(n), tag)
        assert.deepEqual(Fiber.verify(host, { backgroundColor: 'black' }), [{ key: 'backgroundColor', react: 'white', expected: 'black' }])
    }
})

test('getOwners / getCreationStack: dev only', () => {
    let instance: any = null
    function ProfileCard() {
        return h(View, { ref: (r: any) => r && (instance = r) })
    }
    function ProfileScreen() {
        return h(ProfileCard)
    }
    render(h(ProfileScreen))
    const host = Fiber.getHostFor(instance)!

    if (mode === 'development') {
        assert.deepEqual(Fiber.getOwners(host), ['View', 'ProfileCard', 'ProfileScreen'])
        assert.match(Fiber.getCreationStack(host)!, /createElement/)
    } else {
        assert.deepEqual(Fiber.getOwners(host), [])
        assert.equal(Fiber.getCreationStack(host), undefined)
    }
})

test('verify: falsy and non-object entries in a style array are skipped, like RN flattenStyle', () => {
    let instance: any = null
    render(h(View, { ref: (r: any) => r && (instance = r), style: [false, null, 0, 'stray', [undefined, { opacity: 0.5 }]] }))
    const host = Fiber.getHostFor(instance)!

    assert.deepEqual(Fiber.verify(host, { opacity: 0.5 }), [])
    assert.deepEqual(Fiber.verify(host, { opacity: 1 }), [{ key: 'opacity', react: 0.5, expected: 1 }])
})
