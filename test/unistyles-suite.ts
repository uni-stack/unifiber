// Unistyles' real wrappers and registry JS on React Native's own components: what it links, unlinks, suspends and
// refreshes vs unifiber's answers. Where they differ, unifiber must match the committed tree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Fiber, type Host } from '../src/index'

export const runSuite = (platform: 'ios' | 'android') => {
    const require = createRequire(import.meta.url)
    const mode = process.env.UNIFIBER_MODE ?? 'development'
    const { React, RN, render, act } = require('./harness/rn.cjs')({ platform, mode })
    const U = require('./harness/unistyles.cjs')({ platform, mode })
    const { Freeze } = require(require('./harness/paths.cjs').REACT_FREEZE)
    const h = React.createElement
    const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))
    const C = U.components

    // a style object as Unistyles' babel plugin leaves it
    const unistyle = (id: string) => ({ backgroundColor: 'red', [`unistyles_${id}`]: { uni__getStyles: () => ({ backgroundColor: 'red' }) } })
    const linkedNodes = (from: number) => U.calls.slice(from).filter((c: any) => c.op === 'link').map((c: any) => c.node)

    const list = { data: ['a'], keyExtractor: (i: string) => i, renderItem: () => h(RN.View) }
    const CASES: Array<[string, (props: any) => any]> = [
        ['View', (p) => h(C.View, p)],
        ['Text', (p) => h(C.Text, p, 'text')],
        ['Image', (p) => h(C.Image, { ...p, source: { uri: 'a' } })],
        ['ImageBackground', (p) => h(C.ImageBackground, { ...p, source: { uri: 'a' } })],
        ['TextInput', (p) => h(C.TextInput, p)],
        ['Switch', (p) => h(C.Switch, p)],
        ['ScrollView', (p) => h(C.ScrollView, p, h(RN.View))],
        ['ScrollView + refreshControl', (p) => h(C.ScrollView, { ...p, refreshControl: h(RN.RefreshControl, { refreshing: false }) }, h(RN.View))],
        ['FlatList', (p) => h(C.FlatList, { ...p, ...list })],
        ['SectionList', (p) => h(C.SectionList, { ...p, sections: [{ key: 's', data: ['a'] }], keyExtractor: (i: string) => i, renderItem: () => h(RN.View) })],
        ['VirtualizedList', (p) => h(C.VirtualizedList, { ...p, ...list, getItem: (d: any, i: number) => d[i], getItemCount: (d: any) => d.length })],
        ['KeyboardAvoidingView', (p) => h(C.KeyboardAvoidingView, p)],
        ['RefreshControl', (p) => h(C.RefreshControl, { ...p, refreshing: false })],
        ['Pressable', (p) => h(C.Pressable, p)],
        ['TouchableOpacity', (p) => h(C.TouchableOpacity, p)],
        ['TouchableHighlight', (p) => h(C.TouchableHighlight, p, h(RN.View))],
        ['SafeAreaView', (p) => h(C.SafeAreaView, p)],
        ['NativeView', (p) => h(C.NativeView, p)],
        ['NativeText', (p) => h(C.NativeText, p, 'text')],
        ['Animated.View', (p) => h(C.Animated.View, p)],
        ['Animated.ScrollView', (p) => h(C.Animated.ScrollView, p, h(RN.View))],
        ['Animated.FlatList', (p) => h(C.Animated.FlatList, { ...p, ...list })],
    ]

    for (const [name, element] of CASES) {
        test(`${platform}: Unistyles ${name}: the node Unistyles links = Fiber.getShadowNodeFor(the ref the app gets)`, () => {
            let ref: any = null
            const from = U.calls.length
            const tag = render(element({ style: unistyle(name), ref: (r: any) => r && (ref = r) }))
            const linked = linkedNodes(from)

            assert.equal(linked.length, 1, 'Unistyles linked once')
            assert.equal(Fiber.getShadowNodeFor(ref), linked[0])
            const host = Fiber.getHostFor(ref)!
            assert.equal(Fiber.getShadowNode(host), linked[0])

            const beforeUnmount = U.calls.length
            rerender(h(RN.View), tag)
            const removed = U.calls.slice(beforeUnmount).filter((c: any) => c.op === 'unlink' || c.op === 'suspend')
            // ImageBackground has two refs, Pressable re-links: expect only unlinks
            assert.ok(removed.length >= 1 && removed.every((c: any) => c.op === 'unlink'), removed.map((c: any) => c.op).join(','))
            assert.ok(removed.some((c: any) => c.node === linked[0]), 'the linked node is unlinked')
            assert.equal(Fiber.isHidden(host), false)
        })
    }

    test(`${platform}: Unistyles ActivityIndicator: the wrapper view Unistyles links = Fiber.getParentHost`, () => {
        let ref: any = null
        const from = U.calls.length
        render(h(C.ActivityIndicator, { style: unistyle('spinner'), ref: (r: any) => r && (ref = r) }))
        const linked = linkedNodes(from)

        assert.equal(linked.length, 1)
        assert.equal(Fiber.getShadowNode(Fiber.getParentHost(Fiber.getHostFor(ref)!)!), linked[0])
    })

    test(`${platform}: Unistyles remove on freeze: suspend while frozen, unlink on a real unmount`, () => {
        let ref: any = null
        const app = (freeze: boolean, show = true, n = 0) =>
            h(RN.View, { testID: `root-${n}` }, show ? h(Freeze, { freeze }, h(C.View, { style: unistyle('frozen'), ref: (r: any) => r && (ref = r) })) : null)
        const tag = render(app(false))
        const host = Fiber.getHostFor(ref)!
        const decisions: Array<string> = []
        const step = (element: any) => {
            const from = U.calls.length
            rerender(element, tag)
            return U.calls.slice(from).filter((c: any) => c.op === 'unlink' || c.op === 'suspend' || c.op === 'link').map((c: any) => c.op).join(',')
        }

        for (let n = 1; n <= 4; n++) {
            decisions.push(`freeze ${step(app(true, true, n * 10))} (unifiber: hidden ${Fiber.isHidden(host)}, frozen ${Fiber.isFrozen(host)})`)
            decisions.push(`thaw ${step(app(false, true, n * 10 + 1))} (unifiber: hidden ${Fiber.isHidden(host)})`)
        }
        decisions.push(`unmount ${step(app(false, false, 99))}`)
        console.log(`# ${platform} ${decisions.join('\n#   ')}`)

        for (const line of decisions.filter((d) => d.startsWith('freeze'))) assert.match(line, /^freeze suspend .*hidden true, frozen true/)
        for (const line of decisions.filter((d) => d.startsWith('thaw'))) assert.match(line, /^thaw link .*hidden false/)
        assert.equal(decisions.at(-1), 'unmount unlink')
    })

    test(`${platform}: Unistyles refreshReactNodes vs Fiber.collectVisibleAncestors, incl. after freeze/thaw and on a fallback`, () => {
        const pending = { then() {} }
        const Gate = ({ suspend, children }: any) => {
            if (suspend) throw pending
            return children
        }
        const refs = new Map<string, any>()
        const at = (key: string) => (r: any) => r && refs.set(key, r)
        type S = { freeze: boolean; suspend: boolean; n: number }
        const app = (s: S) =>
            h(C.View, { style: unistyle('root'), testID: `root-${s.n}`, ref: at('root') },
                h(Freeze, { freeze: s.freeze },
                    h(C.ScrollView, { style: unistyle('screen'), ref: at('screen') }, h(C.Text, { style: unistyle('title'), ref: at('title') }, 'a'))),
                h(React.Suspense, { fallback: h(C.View, { style: unistyle('fallback'), ref: at('fallback') }) },
                    h(Gate, { suspend: s.suspend }, h(C.Pressable, { style: unistyle('button'), ref: at('button') }))))
        let state: S = { freeze: false, suspend: false, n: 0 }
        const tag = render(app(state))
        const differences: Array<string> = []

        const refresh = (label: string) => {
            // what C++ hands back after a commit: creation fibers of mounted linked views
            const handles = [...refs.values()].map((r) => r.__internalInstanceHandle).filter((f) => f?.stateNode)
            U.setCommittedHandles(handles)
            const from = U.calls.length
            U.runChangeListeners()
            const today = new Set<object>(U.calls.slice(from).filter((c: any) => c.op === 'refreshReactNodes').flatMap((c: any) => c.nodes))

            const ours = new Set<object>()
            Fiber.collectVisibleAncestors(handles.map((f) => Fiber.getHostForInstanceHandle(f)), (x: Host) => Fiber.getShadowNodes(x).forEach((n) => ours.add(n)))

            const expected = new Set<object>()
            for (const f of handles) {
                const x = Fiber.getHostForInstanceHandle(f)!
                if (Fiber.isHidden(x)) continue
                for (let c: Host | undefined = x; c; c = Fiber.getParentHost(c)) Fiber.getShadowNodes(c).forEach((n) => expected.add(n))
            }
            assert.deepEqual([...ours].sort(), [...expected].sort(), label)
            const missing = [...expected].filter((n) => !today.has(n)).length
            const extra = [...today].filter((n) => !expected.has(n)).length
            if (missing || extra) differences.push(`${label}: today misses ${missing} node(s), has ${extra} extra`)
        }

        refresh('initial')
        for (const step of [{ freeze: true }, { freeze: false }, { freeze: true }, { freeze: false }, { suspend: true }, { suspend: false }, {}]) {
            state = { ...state, ...step, n: state.n + 1 }
            rerender(app(state), tag)
            refresh(JSON.stringify(step))
        }
        console.log(`# ${platform} Unistyles refreshReactNodes today vs committed tree:\n#   ${differences.join('\n#   ') || 'no differences'}`)
    })
}
