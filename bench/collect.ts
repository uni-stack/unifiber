// Batch refresh walks on a 3-screen stack (2 frozen). Run with bench/metro.mjs or bench/run-hermes.mjs.
declare const require: any
declare const print: undefined | ((...args: Array<unknown>) => void)
import { collectAncestors, collectVisibleAncestors, getParentHost, isHidden, type Host } from '../src/host'
import { Fiber } from '../src/index'

const log = typeof print === 'function' ? print : console.log
const now: () => number = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now()

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = false
require('../test/harness/stubs.cjs').install()
const React = require('react')
const ReactFabric = require('react-native-renderer')
const Scheduler = require('scheduler')
const h = React.createElement

// react-freeze 1.0.4, inlined
const infinite = { then() {} }
const Suspender = ({ freeze, children }: any) => {
    if (freeze) throw infinite
    return children
}
const Freeze = ({ freeze, children }: any) => h(React.Suspense, { fallback: null }, h(Suspender, { freeze }, children))

const SHELL = 20
const SCREEN = 15
const LEAVES = 300
const Wrap = ({ d, children }: any) => (d === 0 ? children : h(Wrap, { d: d - 1 }, h('RCTView', null, children)))
const refs: Array<Array<any>> = [[], [], []]
const screen = (i: number, frozen: boolean, n: number) =>
    h(Freeze, { key: i, freeze: frozen },
        h(Wrap, { d: SCREEN },
            ...Array.from({ length: LEAVES }, (_, k) => h('RCTView', { key: k, n, ref: (r: any) => r && (refs[i][k] = r) }))))
const app = (frozen: [boolean, boolean, boolean], n: number) => h(Wrap, { d: SHELL }, ...frozen.map((f, i) => screen(i, f, n)))

const commit = (element: any) => {
    ReactFabric.render(element, 1, null, true)
    Scheduler.unstable_flushAll()
}
commit(app([false, false, false], 0))
const hosts: Array<Host> = refs.flat().map((r) => Fiber.getHostFor(r)!)
const fibers = refs.flat().map((r) => r.__internalInstanceHandle)

// Unistyles ShadowRegistry/index.ts:78-130
const unistylesToday = () => {
    const refreshedTags = new Set<number>()
    const hostFibers: Array<any> = []
    let count = 0
    for (const fiber of fibers) {
        let hidden = false
        hostFibers.length = 0
        for (let current: any = fiber; current; current = current.return) {
            if ((current.tag === 13 || current.tag === 22) && current.memoizedState !== null) hidden = true
            if (current.tag !== 5) continue
            if (refreshedTags.has(current.stateNode?.canonical?.nativeTag)) break
            hostFibers.push(current)
        }
        if (hidden) continue
        for (const hostFiber of hostFibers) {
            refreshedTags.add(hostFiber.stateNode?.canonical?.nativeTag)
            count++
        }
    }
    return count
}
// Uniwind fiberBaseline.ts:216-237, counting hosts
const uniwindToday = () => {
    const visited = new Set<any>()
    let count = 0
    for (const fiber of fibers) {
        for (let current = fiber; current && !visited.has(current); current = current.return) {
            visited.add(current)
            if (current.alternate) visited.add(current.alternate)
            if (current.tag === 5) count++
        }
    }
    return count
}
// naive: isHidden per host, then its ancestors
const perHost = () => {
    const seen = new Set<any>()
    let count = 0
    for (const host of hosts) {
        if (isHidden(host)) continue
        for (let current: Host | undefined = host; current && !seen.has(current); current = getParentHost(current)) {
            seen.add(current)
            count++
        }
    }
    return count
}
const collect = () => {
    let count = 0
    collectVisibleAncestors(hosts, () => count++)
    return count
}

// registry-free: walk the committed tree down from HostRoot.current
let fiberCount = 0
const topDown = () => {
    let root: any = fibers[0]
    while (root.return) root = root.return
    let count = 0
    let visited = 0
    const stack: Array<any> = [root.stateNode.current]
    while (stack.length) {
        let fiber = stack.pop()
        for (; fiber; fiber = fiber.sibling) {
            visited++
            if (fiber.tag === 22 && fiber.memoizedState !== null) continue
            if (fiber.tag === 5) count++
            if (fiber.child) stack.push(fiber.child)
        }
    }
    fiberCount = visited
    return count
}
// Uniwind fiberBaseline.ts:216-237, collecting nodes as it does
const uniwindCollectHostNodes = () => {
    const visited = new Set<any>()
    const nodes = new Set<any>()
    for (const fiber of fibers) {
        for (let current = fiber; current && !visited.has(current); current = current.return) {
            visited.add(current)
            if (current.alternate) visited.add(current.alternate)
            if (current.tag !== 5) continue
            for (const target of [current, current.alternate]) {
                const node = target?.stateNode?.node
                if (node) nodes.add(node)
            }
        }
    }
    return nodes.size
}
const shipped = () => {
    let count = 0
    collectAncestors(hosts, () => count++)
    return count
}
// A: no optional chaining
const variantNoOptional = (list: ReadonlyArray<any>, visit: (h: any) => void) => {
    const visited: Array<boolean> = []
    for (let h = 0; h < list.length; h++) {
        for (let current = list[h]; current !== null && current !== undefined; current = current.return) {
            if (current.tag !== 5) continue
            const stateNode = current.stateNode
            if (stateNode === null) break
            const canonical = stateNode.canonical
            if (visited[canonical.nativeTag] === true) break
            visited[canonical.nativeTag] = true
            visit(canonical.internalInstanceHandle)
        }
    }
}
// B: Set<number> instead of the tag-indexed array
const variantSet = (list: ReadonlyArray<any>, visit: (h: any) => void) => {
    const visited = new Set<number>()
    for (let h = 0; h < list.length; h++) {
        for (let current = list[h]; current; current = current.return) {
            if (current.tag !== 5) continue
            const canonical = current.stateNode?.canonical
            if (canonical === undefined || visited.has(canonical.nativeTag)) break
            visited.add(canonical.nativeTag)
            visit(canonical.internalInstanceHandle)
        }
    }
}
// C: stamp on React's canonical object (writes React's memory: lower bound only)
let pass = 0
const variantStamp = (list: ReadonlyArray<any>, visit: (h: any) => void) => {
    const stamp = ++pass
    for (let h = 0; h < list.length; h++) {
        for (let current = list[h]; current; current = current.return) {
            if (current.tag !== 5) continue
            const canonical = current.stateNode?.canonical
            if (canonical === undefined || canonical.__unifiberPass === stamp) break
            canonical.__unifiberPass = stamp
            visit(canonical.internalInstanceHandle)
        }
    }
}
// D: no callback
const variantNoCallback = (list: ReadonlyArray<any>) => {
    const visited: Array<boolean> = []
    let count = 0
    for (let h = 0; h < list.length; h++) {
        for (let current = list[h]; current; current = current.return) {
            if (current.tag !== 5) continue
            const canonical = current.stateNode?.canonical
            if (canonical === undefined || visited[canonical.nativeTag]) break
            visited[canonical.nativeTag] = true
            count++
        }
    }
    return count
}
const counted = (fn: (list: ReadonlyArray<any>, visit: (h: any) => void) => void) => () => {
    let count = 0
    fn(hosts, () => count++)
    return count
}

const cases: Record<string, () => number> = {
    'unistyles today': unistylesToday,
    'uniwind today (no hidden check)': uniwindToday,
    'isHidden per host + walk': perHost,
    'collectVisibleAncestors': collect,
    'uniwind collectHostNodes (nodes)': uniwindCollectHostNodes,
    'collectAncestors (shipped)': shipped,
    'collectAncestors A: no optional chaining': counted(variantNoOptional),
    'collectAncestors B: Set<number>': counted(variantSet),
    'collectAncestors C: stamp on canonical': counted(variantStamp),
    'collectAncestors D: no callback': () => variantNoCallback(hosts),
    'top-down walk, no registry': topDown,
}
const PASSES = Number((globalThis as any).PASSES ?? 200)
const time = (fn: () => number) => {
    const start = now()
    for (let i = 0; i < PASSES; i++) fn()
    return ((now() - start) * 1000) / PASSES
}
const measure = (label: string) => {
    for (const fn of Object.values(cases)) time(fn)
    const results: Record<string, Array<number>> = {}
    for (let round = 0; round < 7; round++) {
        const names = round % 2 ? Object.keys(cases).reverse() : Object.keys(cases)
        for (const name of names) (results[name] ??= []).push(time(cases[name]))
    }
    log(`-- ${label}`)
    for (const name of Object.keys(cases)) {
        const m = results[name].sort((a, b) => a - b)[3]
        log(`${name.padEnd(34)} ${m.toFixed(0).padStart(7)} µs   hosts visited ${String(cases[name]()).padStart(4)}`)
    }
}

log(`${hosts.length} linked leaves, 3 screens, ~${(SHELL + SCREEN) * 2 + 8} fibers deep; µs per batch, median of 7 ABBA rounds`)
commit(app([false, true, true], 1))
measure('screen 0 focused, 1-2 frozen (never toggled back)')
commit(app([true, false, true], 2))
commit(app([false, true, true], 3))
commit(app([false, true, true], 4))
measure('after navigating 0 -> 1 -> 0 (halves disagree on screens 0-1)')
topDown()
log(`committed tree: ${fiberCount} fibers visited by the top-down walk`)
