// ref -> shadow node / Host: the shipped API vs the alternatives in bench/shadowNode.ts.
declare const require: any
declare const print: undefined | ((...args: Array<unknown>) => void)
import { Fiber, Reanimated } from '../src/index'
import { getHostFor, getHostForFn, getHostHandle, hostShadowNode, getHostLiteral, getShadowNode, getShadowNodeOfKind, Kind, shadowNodeResolver, unistylesToday } from './shadowNode'

const log = typeof print === 'function' ? print : console.log
const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
require('../test/harness/stubs.cjs').install()
const React = require('react')
const ReactFabric = require('react-native-renderer')
const Scheduler = require('scheduler')
const h = React.createElement

// RN 0.87 ref shapes (ScrollView.js:1281)
class ScrollView extends React.Component<any> {
    _native: any = null
    setNative = (instance: any) => {
        if (instance) {
            this._native = Object.assign(instance, {
                getScrollResponder: () => this._native,
                getNativeScrollRef: () => this._native,
            })
        }
        const ref = this.props.forwardedRef
        if (typeof ref === 'function') ref(this._native)
    }
    render() {
        return h('RCTScrollView', { ref: this.setNative, style: this.props.style }, h('RCTScrollContentView', null, this.props.children))
    }
}
const ListContext = React.createContext(null)
class VirtualizedList extends React.Component<any> {
    _scrollRef: any = null
    getScrollResponder() {
        return this._scrollRef?.getScrollResponder()
    }
    render() {
        return h(ListContext, { value: this }, h(ScrollView, { forwardedRef: (r: any) => (this._scrollRef = r), style: this.props.style }))
    }
}
class FlatList extends React.Component<any> {
    _listRef: any = null
    getScrollResponder() {
        return this._listRef?.getScrollResponder()
    }
    render() {
        return h(VirtualizedList, { ref: (r: any) => (this._listRef = r), style: this.props.style })
    }
}
class KeyboardAvoidingView extends React.Component<any> {
    viewRef = React.createRef()
    render() {
        return h('RCTView', { ref: this.viewRef, style: this.props.style })
    }
}

const hosts: Array<any> = []
const composites: Array<any> = []
const collect = (into: Array<any>) => (r: any) => {
    if (r) into.push(r)
}
const tree = h(
    'RCTView',
    null,
    ...Array.from({ length: 900 }, (_, i) => h('RCTView', { key: `v${i}`, style: { flex: 1 }, ref: collect(hosts) })),
    ...Array.from({ length: 50 }, (_, i) => h(FlatList, { key: `l${i}`, ref: collect(composites) })),
    ...Array.from({ length: 50 }, (_, i) => h(KeyboardAvoidingView, { key: `k${i}`, ref: collect(composites) })),
)
ReactFabric.render(tree, 1, null, true)
Scheduler.unstable_flushAll()

const lists = composites.filter((c) => c instanceof FlatList)
const kavs = composites.filter((c) => c instanceof KeyboardAvoidingView)
const mixed = hosts.slice(0, 800).concat(lists, kavs)
const mixedKinds = mixed.map((r) => (r instanceof FlatList ? Kind.List : r instanceof KeyboardAvoidingView ? Kind.KeyboardAvoidingView : Kind.Host))
const mixedResolvers = mixedKinds.map(shadowNodeResolver)

for (let i = 0; i < mixed.length; i++) {
    const a = getShadowNodeOfKind(mixed[i], mixedKinds[i])
    if (!a || a !== mixedResolvers[i](mixed[i]) || (mixedKinds[i] !== Kind.KeyboardAvoidingView && a !== unistylesToday(mixed[i]))) {
        throw new Error(`strategies disagree at ${i}`)
    }
}
if (getShadowNode(lists[0]) !== getShadowNodeOfKind(lists[0], Kind.List)) throw new Error('generic list mismatch')

let sink = 0
const kept: Array<unknown> = new Array(900)
// bound once, as consumers should under Metro's inline requires
const { getShadowNodeFor: boundGetShadowNodeFor, getHostFor: boundGetHostFor } = Fiber
const owners = Fiber.createOwnerRegistry({ name: 'bench', epoch: () => 0, resolve: () => undefined }, [Reanimated.cssAdapter])
const linkedHosts = hosts.map((r) => boundGetHostFor(r))
const boundGate = Reanimated.cssAdapter.gate
const keptCtor = hosts.map(getHostForFn)
const keptHandles = hosts.map(getHostHandle)
const FiberObject = { getHostFor: getHostHandle, getShadowNode: hostShadowNode }
class FiberStatic {
    static getHostFor(ref: any) {
        return getHostHandle(ref)
    }
    static getShadowNode(host: any) {
        return hostShadowNode(host)
    }
}
const exportsObject: any = { getHostHandle, hostShadowNode, Fiber: FiberObject, FiberStatic }
const hostResolver = shadowNodeResolver(Kind.Host)
const listResolver = shadowNodeResolver(Kind.List)
const cases: Record<string, () => void> = {
    'hosts: unistyles today': () => {
        for (let i = 0; i < hosts.length; i++) sink += unistylesToday(hosts[i]) ? 1 : 0
    },
    'hosts: getShadowNode(ref)': () => {
        for (let i = 0; i < hosts.length; i++) sink += getShadowNode(hosts[i]) ? 1 : 0
    },
    'hosts: getHostFor(ref).getShadowNode()': () => {
        for (let i = 0; i < hosts.length; i++) sink += getHostFor(hosts[i])?.getShadowNode() ? 1 : 0
    },
    'hosts: getHostFor(ref), kept': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = getHostFor(hosts[i])
    },
    'hosts: function-ctor Host, kept': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = getHostForFn(hosts[i])
    },
    'hosts: {fiber} literal, kept': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = getHostLiteral(hosts[i])
    },
    'hosts: fiber as handle, kept': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = getHostHandle(hosts[i])
    },
    'hosts: Host.getShadowNode(getHostHandle(ref))': () => {
        for (let i = 0; i < hosts.length; i++) sink += hostShadowNode(getHostHandle(hosts[i])) ? 1 : 0
    },
    'kept: ctorHost.getShadowNode()': () => {
        for (let i = 0; i < keptCtor.length; i++) sink += keptCtor[i].getShadowNode() ? 1 : 0
    },
    'kept: mod.getShadowNode(h) (named import)': () => {
        for (let i = 0; i < keptHandles.length; i++) sink += exportsObject.hostShadowNode(keptHandles[i]) ? 1 : 0
    },
    'kept: mod.Fiber.getShadowNode(h) (object)': () => {
        for (let i = 0; i < keptHandles.length; i++) sink += exportsObject.Fiber.getShadowNode(keptHandles[i]) ? 1 : 0
    },
    'kept: mod.FiberStatic.getShadowNode(h) (class)': () => {
        for (let i = 0; i < keptHandles.length; i++) sink += exportsObject.FiberStatic.getShadowNode(keptHandles[i]) ? 1 : 0
    },
    'hosts: mod.getHostHandle(ref), kept': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = exportsObject.getHostHandle(hosts[i])
    },
    'hosts: mod.Fiber.getHostFor(ref), kept': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = exportsObject.Fiber.getHostFor(hosts[i])
    },
    'kept: Host.getShadowNode(handle)': () => {
        for (let i = 0; i < keptHandles.length; i++) sink += hostShadowNode(keptHandles[i]) ? 1 : 0
    },
    'hosts: Fiber.getShadowNodeFor(ref) (shipped)': () => {
        for (let i = 0; i < hosts.length; i++) sink += Fiber.getShadowNodeFor(hosts[i]) ? 1 : 0
    },
    'hosts: Fiber.getHostFor(ref), kept (shipped)': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = Fiber.getHostFor(hosts[i])
    },
    'hosts: getShadowNodeFor(ref) (shipped, bound)': () => {
        for (let i = 0; i < hosts.length; i++) sink += boundGetShadowNodeFor(hosts[i]) ? 1 : 0
    },
    'hosts: getHostFor(ref), kept (shipped, bound)': () => {
        for (let i = 0; i < hosts.length; i++) kept[i] = boundGetHostFor(hosts[i])
    },
    'hosts: cssAdapter.gate(host) only (bound)': () => {
        for (let i = 0; i < linkedHosts.length; i++) sink += boundGate(linkedHosts[i]!) ? 1 : 0
    },
    'hosts: inline collapsable read (floor)': () => {
        for (let i = 0; i < linkedHosts.length; i++) sink += (linkedHosts[i] as any).memoizedProps?.collapsable === false ? 1 : 0
    },
    'hosts: owners.link(host) (Reanimated gate, shipped)': () => {
        for (let i = 0; i < linkedHosts.length; i++) owners.link(linkedHosts[i])
    },
    'mixed 900: Fiber.getShadowNodeFor(ref) (shipped)': () => {
        for (let i = 0; i < mixed.length; i++) sink += Fiber.getShadowNodeFor(mixed[i]) ? 1 : 0
    },
    'hosts: getShadowNode(ref, kind)': () => {
        for (let i = 0; i < hosts.length; i++) sink += getShadowNodeOfKind(hosts[i], Kind.Host) ? 1 : 0
    },
    'hosts: resolver per wrapper': () => {
        for (let i = 0; i < hosts.length; i++) sink += hostResolver(hosts[i]) ? 1 : 0
    },
    'lists: unistyles today': () => {
        for (let i = 0; i < lists.length; i++) sink += unistylesToday(lists[i]) ? 1 : 0
    },
    'lists: getShadowNode(ref) fiber descent': () => {
        for (let i = 0; i < lists.length; i++) sink += getShadowNode(lists[i]) ? 1 : 0
    },
    'lists: resolver per wrapper': () => {
        for (let i = 0; i < lists.length; i++) sink += listResolver(lists[i]) ? 1 : 0
    },
    'mixed 900: getShadowNode(ref)': () => {
        for (let i = 0; i < mixed.length; i++) sink += getShadowNode(mixed[i]) ? 1 : 0
    },
    'mixed 900: getHostFor(ref).getShadowNode()': () => {
        for (let i = 0; i < mixed.length; i++) sink += getHostFor(mixed[i])?.getShadowNode() ? 1 : 0
    },
    'mixed 900: getShadowNode(ref, kind)': () => {
        for (let i = 0; i < mixed.length; i++) sink += getShadowNodeOfKind(mixed[i], mixedKinds[i]) ? 1 : 0
    },
    'mixed 900: resolver per wrapper': () => {
        for (let i = 0; i < mixed.length; i++) sink += mixedResolvers[i](mixed[i]) ? 1 : 0
    },
}

const PASSES = Number((globalThis as any).PASSES ?? 400)
const time = (fn: () => void) => {
    const start = now()
    for (let i = 0; i < PASSES; i++) fn()
    return ((now() - start) * 1000) / PASSES // µs per pass
}
for (const fn of Object.values(cases)) time(fn)
const results: Record<string, Array<number>> = {}
for (let round = 0; round < 11; round++) {
    const names = round % 2 ? Object.keys(cases).reverse() : Object.keys(cases)
    for (const name of names) (results[name] ??= []).push(time(cases[name]))
}
const median = (xs: Array<number>) => xs.slice().sort((a, b) => a - b)[xs.length >> 1]
log(`hosts ${hosts.length}, lists ${lists.length}, mixed ${mixed.length}; µs per pass, median of 11 ABBA rounds`)
for (const name of Object.keys(results)) {
    const n = name.startsWith('lists') ? lists.length : name.startsWith('hosts') || name.startsWith('kept') ? hosts.length : mixed.length
    const m = median(results[name])
    log(`${name.padEnd(42)} ${m.toFixed(1).padStart(8)} µs   ${((m * 1000) / n).toFixed(1).padStart(7)} ns/ref`)
}
if (sink < 0) log(sink)
