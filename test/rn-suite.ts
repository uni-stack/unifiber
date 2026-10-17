// React Native's own components, compared with Unistyles' and Uniwind's lookups (copied, file:line). One platform per process.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Fiber, type Host } from '../src/index'

export const runSuite = (platform: 'ios' | 'android') => {
    const require = createRequire(import.meta.url)
    const mode = process.env.UNIFIBER_MODE ?? 'development'
    const { React, RN, render, act } = require('./harness/rn.cjs')({ platform, mode })
    const h = React.createElement
    const rerender = (element: any, tag: number) => (mode === 'development' ? act(() => render(element, tag)) : render(element, tag))
    const isAndroid = platform === 'android'

    // packages/unistyles/src/specs/ShadowRegistry/index.ts:57-67 (findShadowNodeForHandle)
    const unistylesShadowNode = (handle: any) =>
        handle?.__internalInstanceHandle?.stateNode?.node ??
        handle?.getScrollResponder?.()?.getNativeScrollRef?.()?.__internalInstanceHandle?.stateNode?.node ??
        handle?.getNativeScrollRef?.()?.__internalInstanceHandle?.stateNode?.node ??
        handle?._viewRef?.__internalInstanceHandle?.stateNode?.node ??
        handle?.viewRef?.current?.__internalInstanceHandle?.stateNode?.node ??
        handle?._nativeRef?.__internalInstanceHandle?.stateNode?.node
    // packages/unistyles/src/core/createUnistylesActivityIndicator.tsx:12-17 (getWrapperHandle)
    const unistylesActivityIndicatorWrapper = (ref: any) => {
        const spinner = ref?.__internalInstanceHandle
        return { __internalInstanceHandle: isAndroid ? spinner?.return?.return : spinner?.return }
    }

    // Uniwind packages/uniwind/src/components/native/*
    const uniwindShadowNode: Record<string, (ref: any) => unknown> = {
        host: (ref) => ref?.__internalInstanceHandle?.stateNode?.node, // View.tsx:87-88 and 13 more
        ImageBackground: (ref) => ref?._viewRef?.__internalInstanceHandle?.stateNode?.node, // ImageBackground.tsx:73-74
        KeyboardAvoidingView: (ref) => ref?.viewRef?.current?.__internalInstanceHandle?.stateNode?.node, // KeyboardAvoidingView.tsx:57-58
        RefreshControl: (ref) => ref?._nativeRef?.__internalInstanceHandle?.stateNode?.node, // RefreshControl.tsx:62-63
        ScrollView: (ref) => ref?.getNativeScrollRef?.()?.__internalInstanceHandle?.stateNode?.node, // ScrollView.tsx:96-98
        list: (ref) => ref?.getScrollResponder?.()?.getNativeScrollRef?.()?.__internalInstanceHandle?.stateNode?.node, // FlatList.tsx:86-87, SectionList, VirtualizedList
        // Button.tsx:49-52
        Button: (ref) => (isAndroid ? ref?._reactInternals?.child?.child : ref?.__internalInstanceHandle)?.stateNode?.node,
    }

    type Case = { name: string; element: (ref: any) => any; uniwind?: keyof typeof uniwindShadowNode; unistyles?: boolean }
    const CASES: Array<Case> = [
        { name: 'View', element: (ref) => h(RN.View, { ref, style: { flex: 1 } }), uniwind: 'host', unistyles: true },
        { name: 'Text', element: (ref) => h(RN.Text, { ref }, 'text'), uniwind: 'host', unistyles: true },
        { name: 'Image', element: (ref) => h(RN.Image, { ref, source: { uri: 'a' } }), uniwind: 'host', unistyles: true },
        { name: 'ImageBackground', element: (ref) => h(RN.ImageBackground, { ref, source: { uri: 'a' } }), uniwind: 'ImageBackground', unistyles: true },
        { name: 'TextInput', element: (ref) => h(RN.TextInput, { ref }), uniwind: 'host', unistyles: true },
        { name: 'Switch', element: (ref) => h(RN.Switch, { ref }), uniwind: 'host', unistyles: true },
        { name: 'ScrollView', element: (ref) => h(RN.ScrollView, { ref }, h(RN.View)), uniwind: 'ScrollView', unistyles: true },
        {
            name: 'ScrollView + refreshControl',
            element: (ref) => h(RN.ScrollView, { ref, refreshControl: h(RN.RefreshControl, { refreshing: false }) }, h(RN.View)),
            uniwind: 'ScrollView',
            unistyles: true,
        },
        { name: 'horizontal ScrollView', element: (ref) => h(RN.ScrollView, { ref, horizontal: true }, h(RN.View)), uniwind: 'ScrollView', unistyles: true },
        {
            name: 'FlatList',
            element: (ref) => h(RN.FlatList, { ref, data: ['a', 'b'], keyExtractor: (i: string) => i, renderItem: () => h(RN.View), ListHeaderComponent: h(RN.View) }),
            uniwind: 'list',
            unistyles: true,
        },
        {
            name: 'SectionList',
            element: (ref) => h(RN.SectionList, { ref, sections: [{ key: 's', data: ['a'] }], keyExtractor: (i: string) => i, renderItem: () => h(RN.View) }),
            uniwind: 'list',
            unistyles: true,
        },
        {
            name: 'VirtualizedList',
            element: (ref) =>
                h(RN.VirtualizedList, { ref, data: ['a'], keyExtractor: (i: string) => i, getItem: (d: any, i: number) => d[i], getItemCount: (d: any) => d.length, renderItem: () => h(RN.View) }),
            uniwind: 'list',
            unistyles: true,
        },
        { name: 'KeyboardAvoidingView', element: (ref) => h(RN.KeyboardAvoidingView, { ref }), uniwind: 'KeyboardAvoidingView', unistyles: true },
        { name: 'RefreshControl', element: (ref) => h(RN.RefreshControl, { ref, refreshing: false }), uniwind: 'RefreshControl', unistyles: true },
        { name: 'ActivityIndicator', element: (ref) => h(RN.ActivityIndicator, { ref }), uniwind: 'host' },
        { name: 'Button', element: (ref) => h(RN.Button, { ref, title: 'b', onPress() {} }), uniwind: 'Button' },
        { name: 'Pressable', element: (ref) => h(RN.Pressable, { ref }), uniwind: 'host', unistyles: true },
        { name: 'TouchableOpacity', element: (ref) => h(RN.TouchableOpacity, { ref }), uniwind: 'host', unistyles: true },
        { name: 'TouchableHighlight', element: (ref) => h(RN.TouchableHighlight, { ref }, h(RN.View)), uniwind: 'host', unistyles: true },
        { name: 'TouchableWithoutFeedback (child view)', element: (ref) => h(RN.TouchableWithoutFeedback, null, h(RN.View, { ref })), uniwind: 'host' },
        { name: 'SafeAreaView', element: (ref) => h(RN.SafeAreaView, { ref }), uniwind: 'host', unistyles: true },
        { name: 'Modal content', element: (ref) => h(RN.Modal, { visible: true }, h(RN.View, { ref })), uniwind: 'host' },
        { name: 'Animated.View', element: (ref) => h(RN.Animated.View, { ref }), uniwind: 'host', unistyles: true },
        { name: 'Animated.ScrollView', element: (ref) => h(RN.Animated.ScrollView, { ref }, h(RN.View)), uniwind: 'ScrollView', unistyles: true },
        {
            name: 'Animated.FlatList',
            element: (ref) => h(RN.Animated.FlatList, { ref, data: ['a'], keyExtractor: (i: string) => i, renderItem: () => h(RN.View) }),
            uniwind: 'list',
            unistyles: true,
        },
    ]

    const mount = (element: (ref: any) => any) => {
        const box: { current: any } = { current: null }
        const tag = render(element((r: any) => r && (box.current = r)))
        assert.ok(box.current, 'ref attached')
        return { ref: box.current, tag }
    }

    for (const c of CASES) {
        test(`${platform}: ${c.name}: getHostFor / getShadowNodeFor = what the libraries resolve today`, () => {
            const { ref, tag } = mount(c.element)
            const host = Fiber.getHostFor(ref)

            assert.ok(host, 'resolved')
            const node = Fiber.getShadowNodeFor(ref)
            assert.equal(node, Fiber.getShadowNode(host!))
            assert.equal(typeof node, 'object')

            if (c.unistyles) {
                assert.equal(node, unistylesShadowNode(ref), 'Unistyles findShadowNodeForHandle')
            }
            if (c.uniwind) {
                assert.equal(node, uniwindShadowNode[c.uniwind]!(ref), `Uniwind ${c.uniwind}`)
            }

            for (let i = 0; i < 3; i++) {
                rerender(c.element(() => {}), tag)
            }
            assert.equal(Fiber.getHostFor(ref), host)
            assert.ok(Fiber.getShadowNodes(host!).length >= 1)
            assert.equal(Fiber.isHidden(host!), false)
            assert.equal(typeof Fiber.getNativeTag(host!), 'number')
        })
    }

    test(`${platform}: ActivityIndicator: getParentHost = Unistyles' platform-specific wrapper walk`, () => {
        const { ref } = mount((r) => h(RN.ActivityIndicator, { ref: r, style: { margin: 4 } }))
        const wrapper = unistylesActivityIndicatorWrapper(ref).__internalInstanceHandle
        const parent = Fiber.getParentHost(Fiber.getHostFor(ref)!)

        assert.equal(wrapper.tag, 5, `today's .return${isAndroid ? '.return' : ''} lands on a host`)
        assert.equal(Fiber.getShadowNode(parent!), wrapper.stateNode.node)
    })

    test(`${platform}: content container = Uniwind accents (contentContainer, column wrapper, header/footer)`, () => {
        // accents.ts:15-29 ScrollView
        const scroll = mount((r) => h(RN.ScrollView, { ref: r, refreshControl: h(RN.RefreshControl, { refreshing: false }) }, h(RN.View))).ref
        assert.equal(Fiber.getNativeTag(Fiber.getContentContainerFor(scroll)!), scroll.getInnerViewRef().__nativeTag)
        assert.equal(Fiber.getNativeTag(Fiber.getHostFor(scroll)!), scroll.__nativeTag, 'endFillColor: the scroll view itself')

        // accents.ts:38 (column wrapper / header / footer), :50 (contentContainer), :62 (endFillColor)
        const flat = mount((r) => h(RN.FlatList, { ref: r, data: ['a'], keyExtractor: (i: string) => i, renderItem: () => h(RN.View) })).ref
        const flatContent = Fiber.getContentContainerFor(flat)!
        assert.equal(Fiber.getShadowNode(flatContent), flat.getNativeScrollRef().getInnerViewRef().__internalInstanceHandle.stateNode.node)
        assert.equal(Fiber.getNativeTag(flatContent), flat.getScrollResponder().getInnerViewRef().__nativeTag)
        assert.equal(Fiber.getNativeTag(Fiber.getHostFor(flat)!), flat.getNativeScrollRef().__nativeTag)

        // accents.ts:78 (contentContainer), :90 (header/footer via the private _innerView), :102 (endFillColor)
        for (const List of [RN.SectionList, RN.VirtualizedList]) {
            const props =
                List === RN.SectionList
                    ? { sections: [{ key: 's', data: ['a'] }], keyExtractor: (i: string) => i, renderItem: () => h(RN.View) }
                    : { data: ['a'], keyExtractor: (i: string) => i, getItem: (d: any, i: number) => d[i], getItemCount: (d: any) => d.length, renderItem: () => h(RN.View) }
            const list = mount((r) => h(List, { ref: r, ...props })).ref
            const content = Fiber.getContentContainerFor(list)!
            assert.equal(Fiber.getNativeTag(content), list.getScrollResponder().getInnerViewRef().__nativeTag)
            assert.equal(Fiber.getShadowNode(content), list.getScrollResponder()._innerView.nativeInstance.__internalInstanceHandle.stateNode.node, '_innerView is getInnerViewRef()')
            assert.equal(Fiber.getNativeTag(Fiber.getHostFor(list)!), list.getScrollResponder().getNativeScrollRef().__nativeTag)
        }

        const scrollHost: any = Fiber.getHostFor(scroll)
        let first = scrollHost.child
        while (first && first.tag !== 5) first = first.child
        const content: any = Fiber.getContentContainerFor(scroll)
        if (isAndroid) {
            // the refreshControl wraps the scroll host instead (ScrollView.js:1941)
            assert.equal(first?.stateNode?.canonical?.nativeTag, content.stateNode.canonical.nativeTag)
        } else {
            // RCTRefreshControl up to RN 0.88, PullToRefreshView from 0.89
            assert.match(first?.type, /RefreshControl|PullToRefresh/, 'iOS: refreshControl is the first child of the scroll host')
            assert.notEqual(first?.stateNode?.canonical?.nativeTag, content.stateNode.canonical.nativeTag)
        }
    })

    test(`${platform}: hidden state on real components: Activity, Suspense, react-freeze shape`, () => {
        const pending = { then() {} }
        const Gate = ({ suspend, children }: any) => {
            if (suspend) throw pending
            return children
        }
        const refs: Record<string, any> = {}
        const at = (key: string) => (r: any) => r && (refs[key] = r)
        const app = (s: { activity: 'visible' | 'hidden'; suspend: boolean; n: number }) =>
            h(RN.View, { testID: `root-${s.n}` },
                h(React.Activity, { mode: s.activity }, h(RN.ScrollView, { ref: at('scroll') }, h(RN.Text, { ref: at('text') }, 'a'))),
                h(React.Suspense, { fallback: h(RN.ActivityIndicator, { ref: at('spinner') }) },
                    h(Gate, { suspend: s.suspend }, h(RN.Pressable, { ref: at('pressable') }))))
        let state = { activity: 'visible' as const, suspend: false, n: 0 } as { activity: 'visible' | 'hidden'; suspend: boolean; n: number }
        const tag = render(app(state))
        const host = (key: string) => Fiber.getHostFor(refs[key]) as Host

        const steps: Array<[Partial<typeof state>, Record<string, [boolean, boolean, boolean]>]> = [
            // key: [isHidden, isInHiddenActivity, isSuspended]
            [{ activity: 'hidden' }, { scroll: [true, true, false], text: [true, true, false], pressable: [false, false, false] }],
            [{ activity: 'visible', suspend: true }, { scroll: [false, false, false], text: [false, false, false], pressable: [true, false, true], spinner: [false, false, false] }],
            [{ suspend: false }, { pressable: [false, false, false] }],
            [{}, { scroll: [false, false, false], pressable: [false, false, false] }],
        ]
        for (const [step, expected] of steps) {
            state = { ...state, ...step, n: state.n + 1 }
            rerender(app(state), tag)
            for (const [key, [hidden, activity, suspended]] of Object.entries(expected)) {
                const x = host(key)
                assert.deepEqual([Fiber.isHidden(x), Fiber.isInHiddenActivity(x), Fiber.isSuspended(x), Fiber.isFrozen(x)], [hidden, activity, suspended, false], `${key} after ${JSON.stringify(step)}`)
            }
        }
    })

    test(`${platform}: batch refresh over a real screen = per-view oracle`, () => {
        const refs = new Set<any>()
        const at = (r: any) => r && refs.add(r)
        // link while visible, then hide: React doesn't attach refs in an Activity that mounts hidden
        const screen = (mode: 'visible' | 'hidden') =>
            h(RN.View, null,
                h(RN.ScrollView, { ref: at }, h(RN.View, { ref: at }, h(RN.Text, { ref: at }, 'a'), h(RN.Image, { ref: at, source: { uri: 'a' } }))),
                h(RN.FlatList, { ref: at, data: ['a', 'b'], keyExtractor: (i: string) => i, renderItem: () => h(RN.Pressable, { ref: at }) }),
                h(React.Activity, { mode }, h(RN.View, { ref: at }, h(RN.TextInput, { ref: at }))))
        const tag = render(screen('visible'))
        const hosts = [...refs].map((r) => Fiber.getHostFor(r)!)
        rerender(screen('hidden'), tag)
        assert.equal(hosts.filter((x) => Fiber.isInHiddenActivity(x)).length, 2, 'two linked views are now hidden')
        const visited: Array<number> = []
        Fiber.collectVisibleAncestors(hosts, (x) => visited.push(Fiber.getNativeTag(x)!))

        const expected = new Set<number>()
        for (const x of hosts) {
            if (Fiber.isHidden(x)) continue
            for (let c: Host | undefined = x; c; c = Fiber.getParentHost(c)) expected.add(Fiber.getNativeTag(c)!)
        }
        assert.deepEqual(visited.sort((a, b) => a - b), [...expected].sort((a, b) => a - b))
        assert.equal(new Set(visited).size, visited.length, 'each host once')

        // Uniwind fiberBaseline.ts:216-236
        const uniwind = new Set<object>()
        const seenFibers = new Set<any>()
        for (const x of hosts) {
            for (let current: any = x; current && !seenFibers.has(current); current = current.return) {
                seenFibers.add(current)
                if (current.alternate) seenFibers.add(current.alternate)
                if (current.tag !== 5) continue
                for (const target of [current, current.alternate]) if (target?.stateNode?.node) uniwind.add(target.stateNode.node)
            }
        }
        const ours = new Set<object>()
        Fiber.collectAncestors(hosts, (x) => Fiber.getShadowNodes(x).forEach((n) => ours.add(n)))
        assert.deepEqual([...ours].filter((n) => !uniwind.has(n)).length + [...uniwind].filter((n) => !ours.has(n)).length, 0)
        const all: Array<number> = []
        Fiber.collectAncestors(hosts, (x) => all.push(Fiber.getNativeTag(x)!))
        assert.equal(all.length, visited.length + 2, 'the two hidden views are included, visible ones once each')
    })

    test(`${platform}: verify + patchRenderedProps on a real View`, () => {
        const style = [{ backgroundColor: 'white' }, { padding: 2 }]
        const { ref } = mount((r) => h(RN.View, { ref: r, style }))
        const host = Fiber.getHostFor(ref)!

        assert.deepEqual(Fiber.verify(host, { backgroundColor: 'black' }), [{ key: 'backgroundColor', react: 'white', expected: 'black' }])
        assert.equal(Fiber.patchRenderedProps(host, (props) => ({ ...props, style: [{ backgroundColor: 'black' }, { padding: 2 }] })), true)
        assert.deepEqual(Fiber.verify(host, { backgroundColor: 'black', padding: 2 }), [])
    })

    test(`${platform}: dev owner names reach the user's component through RN's wrappers`, () => {
        function ProfileCard() {
            return h(RN.Pressable, { ref: (r: any) => r && (card = r) }, h(RN.Text, null, 'x'))
        }
        let card: any = null
        render(h(ProfileCard))
        const owners = Fiber.getOwners(Fiber.getHostFor(card)!)

        if (mode === 'development') {
            assert.ok(owners.includes('ProfileCard'), owners.join(' > '))
            assert.match(Fiber.getCreationStack(Fiber.getHostFor(card)!)!, /\n/)
        } else {
            assert.deepEqual(owners, [])
        }
    })
}
