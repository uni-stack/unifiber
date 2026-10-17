// Reanimated CSS adapter on the real renderer, with a stand-in copying Reanimated 4.7's AnimatedComponent lifecycle.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Fiber, Reanimated, type Host } from '../src/index'
import { reanimatedCSSAdapter } from '../src/adapters/reanimated'
import { createOwnerRegistry, type StyleSource } from '../src/adapters/registry'

const require = createRequire(import.meta.url)
const { React, render, View } = require('./harness/fabric.cjs')({ mode: process.env.UNIFIBER_MODE ?? 'development' })
const h = React.createElement


class FakeCSSManager {
    previous: Record<string, unknown> = {}
    started: Array<[string, unknown, unknown]> = []
    updates = 0
    update(style: Record<string, unknown>, _props?: unknown) {
        this.updates++
        const properties = style.transitionProperty as Array<string> | undefined
        for (const key of properties ?? []) {
            if (this.previous[key] !== undefined && this.previous[key] !== style[key]) {
                this.started.push([key, this.previous[key], style[key]])
            }
        }
        this.previous = { ...style }
    }
}
const managers: Array<FakeCSSManager> = []

class AnimatedComponentBase extends React.Component<any> {
    _CSSManager?: FakeCSSManager
    _cssStyle: Record<string, unknown> = {}
    _componentRef: any = null
    _willUnmount = false
    // 4.7 css/component/AnimatedComponent.native.tsx: forwards, then keeps the ref it animates
    _setComponentRef = (ref: any) => {
        const forwarded = this.props.forwardedRef
        if (typeof forwarded === 'function') forwarded(ref)
        if (ref && ref !== this._componentRef) this._componentRef = ref
    }
    _updateStyles(props: any) {
        this._cssStyle = Object.assign({}, ...[props.style].flat(Infinity).filter(Boolean))
    }
    componentDidMount() {
        this._updateStyles(this.props)
        this._CSSManager ??= new FakeCSSManager()
        managers.push(this._CSSManager)
        this._CSSManager.update(this._cssStyle, this.props)
        this._willUnmount = false
    }
    // React also calls it when the subtree is hidden (frozen, suspended, hidden Activity)
    componentWillUnmount() {
        this._willUnmount = true
    }
    shouldComponentUpdate(nextProps: any) {
        this._updateStyles(nextProps)
        this._CSSManager?.update(this._cssStyle, nextProps)
        return true
    }
    render() {
        const Child = this.props.child ?? UnistylesView
        return h(Child, { ...this.props, collapsable: false, ref: this._setComponentRef })
    }
}
// createAnimatedComponent: overrides _updateStyles to split shared-value styles out
class AnimatedView extends AnimatedComponentBase {
    _updateStyles(props: any) {
        const flat = Object.assign({}, ...[props.style].flat(Infinity).filter(Boolean))
        for (const key in flat) {
            if (key.startsWith('unistyles_')) delete flat[key]
        }
        this._cssStyle = flat
    }
}

// Unistyles stand-in: snapshot styles, a hidden getter, scoped theme through context
const themes: Record<string, { bg: string }> = { light: { bg: 'white' }, dark: { bg: 'black' }, red: { bg: 'red' } }
let globalTheme = 'light'
let epoch = 0
let resolveCalls = 0
const ScopedThemeContext = React.createContext(null)
const makeStyle = (extra: Record<string, unknown> = {}) => ({
    backgroundColor: themes[globalTheme]!.bg, // snapshot, like HostUnistyle._cache
    ...extra,
    unistyles_abc: { uni__getStyles: (scope?: string) => ({ backgroundColor: themes[scope ?? globalTheme]!.bg, ...extra }) },
})
const source: StyleSource = {
    name: 'unistyles',
    epoch: () => (process.env.NO_CACHE ? ++epoch : epoch),
    contexts: [ScopedThemeContext],
    // stable scopes are renamed in place: key on the name, not the object
    contextKey: (_context, value) => (process.env.NO_CONTEXT_KEY ? value : (value as { name?: string } | null)?.name),
    resolve: (props, read) => {
        resolveCalls++
        const scope = read<{ name: string } | null>(ScopedThemeContext)?.name
        const out: Record<string, unknown> = {}
        let ours = false
        for (const style of [props.style].flat(Infinity)) {
            if (!style) continue
            Object.assign(out, style)
            for (const key in style) {
                if (key.startsWith('unistyles_')) {
                    ours = true
                    Object.assign(out, style[key].uni__getStyles(scope))
                }
            }
        }
        return ours ? out : undefined
    },
}
const registry = createOwnerRegistry(source, process.env.NO_ADAPTER ? [] : [reanimatedCSSAdapter])
const linked: Array<Host> = []
const unistylesRef = (outer: any) => (r: any) => {
    if (typeof outer === 'function') outer(r)
    const fiber = Fiber.getHostFor(r)
    if (fiber) {
        linked.push(fiber)
        registry.link(fiber)
    }
}
function UnistylesView({ ref, ...props }: any) {
    return h(View, { ...props, ref: unistylesRef(ref) })
}
const setTheme = (name: string) => {
    globalTheme = name
    epoch++
    // native side updated the shadow tree; refresh only what that commit touched
    registry.refresh(linked)
}

beforeEach(() => {
    managers.length = 0
    linked.length = 0
    globalTheme = 'light'
    resolveCalls = 0
})

const transition = { transitionProperty: ['backgroundColor'], transitionDuration: 300 }

test('theme change without a React render starts the transition to the new value', () => {
    render(h(AnimatedView, { style: makeStyle(transition) }))
    setTheme('dark')

    assert.deepEqual(managers[0]!.started, [['backgroundColor', 'white', 'black']])
})

test('a later React render with the stale snapshot does not transition back', () => {
    const style = makeStyle(transition) // memoized: still says white after the flip
    const tag = render(h(AnimatedView, { style }))
    setTheme('dark')
    render(h(AnimatedView, { style }), tag)

    assert.deepEqual(managers[0]!.started, [['backgroundColor', 'white', 'black']])
    assert.equal(managers[0]!.previous.backgroundColor, 'black')
})

test('second bug: a scoped theme reaches Reanimated at mount, not the global one', () => {
    render(h(ScopedThemeContext, { value: { name: 'red' } }, h(AnimatedView, { style: makeStyle(transition) })))

    assert.equal(managers[0]!.previous.backgroundColor, 'red')
    setTheme('dark')
    assert.deepEqual(managers[0]!.started, [], 'scope still wins after a global flip')
})

test('per-change cache: re-renders with the same style and epoch resolve once', () => {
    const style = makeStyle(transition)
    const tag = render(h(AnimatedView, { style }))
    const afterMount = resolveCalls

    for (let i = 0; i < 5; i++) render(h(AnimatedView, { style }), tag)
    assert.equal(resolveCalls, afterMount)

    setTheme('dark')
    assert.equal(resolveCalls, afterMount + 1)
})

test('Animated views without CSS config are left to Reanimated', () => {
    render(h(AnimatedView, { style: makeStyle() }))
    setTheme('dark')

    assert.equal(resolveCalls, 0)
    assert.deepEqual(managers[0]!.started, [])
})

test('plain views never get past the gate', () => {
    let claims = 0
    const counting = createOwnerRegistry(source, [{ ...reanimatedCSSAdapter, claim: (f) => (claims++, reanimatedCSSAdapter.claim(f)) }])
    const refs: Array<any> = []
    render(h(View, null, ...Array.from({ length: 50 }, (_, i) => h(View, { key: i, ref: (r: any) => refs.push(r) }))))
    refs.forEach((r) => counting.link(Fiber.getHostFor(r)))

    assert.equal(claims, 0)
})

test('collapsable={false} on someone else\'s class: claimed as nothing', () => {
    class Other extends React.Component {
        render() {
            return h(View, { collapsable: false, ref: (r: any) => registry.link(Fiber.getHostFor(r)) })
        }
    }
    assert.doesNotThrow(() => render(h(Other)))
})

test('an adapter that throws is switched off, the app keeps rendering', () => {
    const reasons: Array<string> = []
    const broken = createOwnerRegistry(source, [{ ...reanimatedCSSAdapter, name: 'broken', claim: () => { throw new Error('field moved') } }], (reason) => reasons.push(reason))
    const refs: Array<any> = []
    render(h(AnimatedView, { style: makeStyle(transition), ref: undefined }))
    render(h(View, { collapsable: false, ref: (r: any) => refs.push(r) }))

    broken.link(Fiber.getHostFor(refs[0]))
    broken.link(Fiber.getHostFor(refs[0]))
    assert.equal(reasons.length, 1)
    assert.match(reasons[0]!, /broken failed/)
})

test('edge: a mounted ScopedTheme changing its name, read from _reactInternals during render', () => {
    const seen: Array<string | undefined> = []
    const style = makeStyle(transition)
    const app = (name: string) => h(ScopedThemeContext, { value: { name } }, h(AnimatedView, { style }))
    const tag = render(app('red'))
    for (const name of ['dark', 'red', 'dark', 'light']) {
        render(app(name), tag)
        seen.push(managers[0]!.previous.backgroundColor as string)
    }
    // expected: black, red, black, white
    console.log('# scope flips seen by Reanimated:', seen.join(', '))
    assert.deepEqual(seen, ['black', 'red', 'black', 'white'])
})

// Animated.ScrollView: RN's ScrollView class sits between AnimatedComponent and the host, so "nearest class" is wrong
class ScrollViewLike extends React.Component<any> {
    render() {
        const { forwardedRef, ...rest } = this.props
        return h('RCTScrollView', { ...rest, ref: unistylesRef(forwardedRef) })
    }
}
const ScrollViewChild = ({ ref, ...props }: any) => h(ScrollViewLike, { ...props, forwardedRef: ref })
// Android + refreshControl (ScrollView.js:1925-1956): the scroll host is a child of RefreshControl's native host
class RefreshControlLike extends React.Component<any> {
    render() {
        return h('AndroidSwipeRefreshLayout', { style: this.props.style }, this.props.children)
    }
}
class AndroidRefreshScrollViewLike extends React.Component<any> {
    render() {
        const { forwardedRef, ...rest } = this.props
        return h(RefreshControlLike, null, h('RCTScrollView', { ...rest, ref: unistylesRef(forwardedRef) }))
    }
}
const UnistylesWrapper = (Inner: any) => ({ ref, ...props }: any) => h(Inner, { ...props, forwardedRef: ref })
const AndroidRefreshScrollChild = UnistylesWrapper(({ forwardedRef, ...props }: any) => h(AndroidRefreshScrollViewLike, { ...props, forwardedRef }))

test('reanimated check: the AnimatedComponent whose _componentRef is this host', async () => {
    const { animatedComponentOf } = Reanimated
    const hosts: Array<any> = []
    const keep = (r: any) => r && hosts.push(Fiber.getHostFor(r))
    class Other extends React.Component<any> {
        _componentRef: any = null // same field name, but it doesn't hold this host
        render() {
            return h(View, { collapsable: false, ref: keep })
        }
    }
    render(h(View, null,
        h(AnimatedView, { style: makeStyle(transition), forwardedRef: keep }),
        h(AnimatedView, { style: makeStyle(transition), child: ScrollViewChild, forwardedRef: keep }),
        h(View, { ref: keep }),
        h(Other),
        h(AnimatedView, { style: makeStyle(transition), child: AndroidRefreshScrollChild, forwardedRef: keep })))

    const [animated, scroll, plain, other, refreshScroll] = hosts
    assert.ok(animatedComponentOf(refreshScroll) instanceof AnimatedView, 'Android refreshControl: walks past the AndroidSwipeRefreshLayout host')
    assert.ok(animatedComponentOf(animated) instanceof AnimatedView)
    assert.ok(animatedComponentOf(scroll) instanceof AnimatedView, 'skips the ScrollView class in between')
    assert.equal(animatedComponentOf(plain), null)
    assert.equal(animatedComponentOf(other), null)
})

// A stable scope is renamed in place, so the adapter must key its cache on the name, not the object
test('stable scope: a rename without a React render still reaches Reanimated CSS transitions', () => {
    const scope = { name: 'red' }
    render(h(ScopedThemeContext, { value: scope }, h(AnimatedView, { style: makeStyle(transition) })))
    assert.equal(managers[0]!.previous.backgroundColor, 'red')

    scope.name = 'dark'
    registry.refresh(linked)

    assert.deepEqual(managers[0]!.started, [['backgroundColor', 'red', 'black']])
})

test('hidden owner with a transition: refreshed while hidden, the reveal shows the new value', () => {
    const app = (mode: 'visible' | 'hidden') => h(React.Activity, { mode }, h(AnimatedView, { style: makeStyle(transition) }))
    const tag = render(app('visible'))
    const manager = managers[0]!
    render(app('hidden'), tag)

    setTheme('dark')
    assert.deepEqual(manager.started, [['backgroundColor', 'white', 'black']], 'transition ran while hidden')
    assert.equal(manager.previous.backgroundColor, 'black')

    manager.started.length = 0
    render(app('visible'), tag)
    assert.deepEqual(manager.started, [], 'no transition from the pre-hide value on reveal')
})

test('hidden owner with a keyframe animation or pseudo-style: not refreshed until it is revealed', () => {
    for (const extra of [{ animationName: { from: { opacity: 0 } }, animationDuration: 300 }, { opacity: { default: 1, ':pressed': 0.5 }, ...transition }]) {
        managers.length = 0
        linked.length = 0
        globalTheme = 'light'
        const app = (mode: 'visible' | 'hidden') => h(React.Activity, { mode }, h(AnimatedView, { style: makeStyle(extra) }))
        const tag = render(app('visible'))
        const manager = managers[0]!
        render(app('hidden'), tag)
        const updates = manager.updates

        setTheme('dark')
        assert.equal(manager.updates, updates, `${Object.keys(extra)[0]}: nothing re-registers on a hidden owner`)

        setTheme('light')
        render(app('visible'), tag)
        setTheme('dark')
        assert.ok(manager.updates > updates, 'visible again: refreshed')
        render(null, tag)
    }
})
