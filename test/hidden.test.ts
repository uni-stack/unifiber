// Hidden predicates through state sequences, on a Host kept from link time and on the other fiber half.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Fiber } from '../src/index'
import { HiddenBy, getHiddenReasons, type Host } from '../src/host'

const hostOfFiber = (fiber: unknown) => fiber as Host

const require = createRequire(import.meta.url)
const mode = process.env.UNIFIBER_MODE ?? 'development'
const { React, render, act, View } = require('./harness/fabric.cjs')({ mode })
const h = React.createElement
const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))
const { Freeze } = require(require('./harness/paths.cjs').REACT_FREEZE)


const pending = { then() {} }
const Gate = ({ suspend, children }: any) => {
    if (suspend) throw pending
    return children
}

type State = { suspend: boolean; freeze: boolean; activity: 'visible' | 'hidden'; n: number }
const reasonsOf = (s: State, innerSuspended: boolean) =>
    (innerSuspended ? HiddenBy.Suspense : 0) | (s.freeze ? HiddenBy.Freeze : 0) | (s.activity === 'hidden' ? HiddenBy.Activity : 0)

// `n` re-renders the parent so fiber halves keep swapping
const app = (s: State, ref: any) =>
    h(View, { testID: `root-${s.n}` },
        h(React.Activity, { mode: s.activity },
            h(Freeze, { freeze: s.freeze },
                h(React.Suspense, { fallback: null },
                    h(Gate, { suspend: s.suspend }, h(View, { ref, testID: 'leaf' }))))))

const run = (steps: Array<Partial<State>>) => {
    let instance: any = null
    const ref = (r: any) => {
        if (r) instance = r
    }
    let state: State = { suspend: false, freeze: false, activity: 'visible', n: 0 }
    const tag = render(app(state, ref))
    const host = Fiber.getHostFor(instance)!
    const creation = host as any
    const failures: Array<string> = []
    // while frozen, the Suspense inside Freeze never re-renders: it keeps its last committed state
    let innerSuspended = false

    for (const [i, step] of steps.entries()) {
        state = { ...state, ...step, n: state.n + 1 }
        rerender(app(state, ref), tag)
        innerSuspended = state.freeze ? innerSuspended : state.suspend
        const expected = reasonsOf(state, innerSuspended)
        const halves = [['kept Host', host], ['alternate', creation.alternate && hostOfFiber(creation.alternate)]] as const

        for (const [name, h] of halves) {
            if (!h) continue
            const got = getHiddenReasons(h)
            if (got !== expected) failures.push(`step ${i} ${JSON.stringify(step)} ${name}: got ${got}, expected ${expected}`)
        }
    }

    return failures
}

test('Suspense: fallback on / off, parent re-rendering in between', () => {
    assert.deepEqual(run([{ suspend: true }, {}, { suspend: false }, {}, { suspend: true }, { suspend: false }]), [])
})

test('Activity: hidden / visible, parent re-rendering in between', () => {
    assert.deepEqual(run([{ activity: 'hidden' }, {}, { activity: 'visible' }, {}, { activity: 'hidden' }, { activity: 'visible' }]), [])
})

test('react-freeze: frozen / thawed, reported as Freeze not Suspense', () => {
    assert.deepEqual(run([{ freeze: true }, {}, { freeze: false }, {}, { freeze: true }, { freeze: false }]), [])
})

test('nested: frozen screen inside a hidden Activity, then each released', () => {
    assert.deepEqual(run([{ freeze: true }, { activity: 'hidden' }, { freeze: false }, { activity: 'visible' }, { suspend: true }, { freeze: true }, { suspend: false }, { freeze: false }]), [])
})

test('predicates', () => {
    let instance: any = null
    const ref = (r: any) => {
        if (r) instance = r
    }
    const tag = render(app({ suspend: false, freeze: false, activity: 'visible', n: 0 }, ref))
    const host = Fiber.getHostFor(instance)!

    assert.deepEqual([Fiber.isHidden(host), Fiber.isSuspended(host), Fiber.isFrozen(host), Fiber.isInHiddenActivity(host)], [false, false, false, false])
    rerender(app({ suspend: false, freeze: true, activity: 'visible', n: 1 }, ref), tag)
    assert.deepEqual([Fiber.isHidden(host), Fiber.isSuspended(host), Fiber.isFrozen(host), Fiber.isInHiddenActivity(host)], [true, false, true, false])
})

// Unistyles ShadowRegistry/index.ts:31-44, Uniwind utils/shadowNode.ts:7-19
const unistylesToday = (fiber: any) => {
    for (let c = fiber?.return; c; c = c.return) if ((c.tag === 13 || c.tag === 22) && c.memoizedState !== null) return true
    return false
}
const uniwindToday = (fiber: any) => {
    for (let c = fiber?.return; c; c = c.return) if (c.tag === 13 && c.memoizedState !== null) return true
    return false
}

test('today: after a screen is frozen and thawed, the creation fiber still reads as hidden', () => {
    let instance: any = null
    const ref = (r: any) => {
        if (r) instance = r
    }
    const seen: Array<string> = []
    let state: State = { suspend: false, freeze: false, activity: 'visible', n: 0 }
    const tag = render(app(state, ref))
    const creation = instance.__internalInstanceHandle
    const host = Fiber.getHostFor(instance)!

    for (const freeze of [true, false, true, false]) {
        state = { ...state, freeze, n: state.n + 1 }
        rerender(app(state, ref), tag)
        seen.push(`${freeze ? 'frozen' : 'thawed'}: unistyles ${unistylesToday(creation)}, uniwind ${uniwindToday(creation)}, host ${Fiber.isHidden(host)}`)
    }
    console.log('# ' + seen.join('\n# '))
    assert.equal(Fiber.isHidden(host), false)
})

test('identity: the same view is the same Host, from a ref or from a walk, after any number of re-renders', () => {
    let leaf: any = null
    let root: any = null
    const app = (n: number) =>
        h(View, { ref: (r: any) => r && (root = r), testID: `root-${n}` }, h(View, { ref: (r: any) => r && (leaf = r), testID: `leaf-${n}` }))
    const tag = render(app(0))
    const host = Fiber.getHostFor(leaf)!
    const parent = Fiber.getHostFor(root)!
    const seen = new WeakMap([[host, 'leaf']])

    for (let n = 1; n <= 4; n++) {
        rerender(app(n), tag)
        const walked = (host as any).alternate
        assert.equal(Fiber.getParentHost(hostOfFiber(walked)), parent)
        assert.equal(Fiber.getParentHost(host), parent)
        assert.equal(Fiber.getHostFor(leaf), host)
        assert.equal(seen.get(Fiber.getHostFor(leaf)!), 'leaf')
    }
})

test('getHostFor: a class that renders its host (Button on Android), and handles from C++, give the same Host', () => {
    class Touchable extends React.Component<any> {
        render() {
            return h(View, { testID: `button-${this.props.n}`, ref: this.props.hostRef })
        }
    }
    let button: any = null
    let host: any = null
    const app = (n: number) => h(View, null, h(Touchable, { n, ref: (r: any) => r && (button = r), hostRef: (r: any) => r && (host = r) }))
    const tag = render(app(0))

    for (let n = 1; n <= 3; n++) {
        rerender(app(n), tag)
        const expected = Fiber.getHostFor(host)!
        assert.equal(Fiber.getHostFor(button), expected)
        assert.equal(Fiber.getHostForInstanceHandle((expected as any).alternate), expected)
        assert.equal(Fiber.getNativeTag(expected), host.__nativeTag)
        assert.equal(Fiber.getShadowNodeFor(button), Fiber.getShadowNode(expected))
    }
})
