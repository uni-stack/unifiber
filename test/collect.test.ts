// collectVisibleAncestors / collectAncestors vs per-host oracles through Suspense, Activity and react-freeze sequences.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { Fiber, type Host } from '../src/index'

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
const LEAVES = 4

const app = (s: State, ref: (key: string) => any) =>
    h(View, { testID: `root-${s.n}` },
        h(View, { testID: 'visible' }, ...Array.from({ length: LEAVES }, (_, i) => h(View, { key: i, ref: ref(`v${i}`) }))),
        h(React.Activity, { mode: s.activity },
            h(Freeze, { freeze: s.freeze },
                h(React.Suspense, { fallback: h(View, { testID: 'fallback', ref: ref('fallback') }) },
                    h(Gate, { suspend: s.suspend },
                        h(View, { testID: `screen-${s.n}` },
                            h(View, null, ...Array.from({ length: LEAVES }, (_, i) => h(View, { key: i, ref: ref(`s${i}`) })))))))))

const tagsOf = (collect: (visit: (host: Host) => void) => void) => {
    const tags: Array<number> = []
    collect((host) => tags.push(Fiber.getNativeTag(host)!))
    return tags.sort((a, b) => a - b)
}

const oracle = (hosts: Array<Host>) =>
    tagsOf((visit) => {
        const seen = new Set<number>()
        for (const host of hosts) {
            if (Fiber.getNativeTag(host) === undefined || Fiber.isHidden(host)) continue // unmounted, or hidden
            for (let current: Host | undefined = host; current; current = Fiber.getParentHost(current)) {
                const tag = Fiber.getNativeTag(current)!
                if (seen.has(tag)) break
                seen.add(tag)
                visit(current)
            }
        }
    })

// Unistyles ShadowRegistry/index.ts:99-124
const unistylesToday = (fibers: Array<any>) => {
    const tags = new Set<number>()
    for (const fiber of fibers) {
        if (!fiber.stateNode) continue // unmounted: the registry would have unlinked it
        const chain: Array<number> = []
        let hidden = false
        for (let current = fiber; current; current = current.return) {
            if ((current.tag === 13 || current.tag === 22) && current.memoizedState !== null) {
                hidden = true
                break
            }
            if (current.tag === 5) chain.push(current.stateNode?.canonical?.nativeTag)
        }
        if (!hidden) for (const tag of chain) tags.add(tag)
    }
    return [...tags].sort((a, b) => a - b)
}

const shuffle = <T>(items: Array<T>, seed: number) => {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        const j = seed % (i + 1)
        ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
}

// Uniwind fiberBaseline.ts:216-236
const uniwindCollectHostNodes = (fiber: any, nodes: Set<object>, visited: Set<any>) => {
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

const allAncestorsOracle = (hosts: Array<Host>) =>
    tagsOf((visit) => {
        const seen = new Set<number>()
        for (const host of hosts) {
            if (Fiber.getNativeTag(host) === undefined) continue // unmounted
            for (let current: Host | undefined = host; current; current = Fiber.getParentHost(current)) {
                const tag = Fiber.getNativeTag(current)!
                if (seen.has(tag)) break
                seen.add(tag)
                visit(current)
            }
        }
    })

const run = (steps: Array<Partial<State>>) => {
    const instances = new Map<string, any>()
    const ref = (key: string) => (r: any) => r && instances.set(key, r)
    let state: State = { suspend: false, freeze: false, activity: 'visible', n: 0 }
    const tag = render(app(state, ref))
    const hosts = [...instances.values()].map((r) => Fiber.getHostFor(r)!)
    const failures: Array<string> = []
    const today: Array<string> = []

    for (const [i, step] of steps.entries()) {
        state = { ...state, ...step, n: state.n + 1 }
        rerender(app(state, ref), tag)
        for (const r of instances.values()) {
            const host = Fiber.getHostFor(r)!
            if (!hosts.includes(host)) hosts.push(host)
        }
        const expected = oracle(hosts)

        const allExpected = allAncestorsOracle(hosts)
        for (const seed of [1, 2, 3]) {
            const all = tagsOf((visit) => Fiber.collectAncestors(shuffle(hosts, seed), visit))
            if (JSON.stringify(all) !== JSON.stringify(allExpected)) failures.push(`step ${i} collectAncestors seed ${seed}: ${all} vs ${allExpected}`)
        }
        const uniwindNodes = new Set<object>()
        const visitedFibers = new Set<any>()
        for (const host of hosts) if (Fiber.getNativeTag(host) !== undefined) uniwindCollectHostNodes(host, uniwindNodes, visitedFibers)
        const ourNodes = new Set<object>()
        Fiber.collectAncestors(hosts, (x) => Fiber.getShadowNodes(x).forEach((n) => ourNodes.add(n)))
        const missing = [...uniwindNodes].filter((n) => !ourNodes.has(n)).length
        const extra = [...ourNodes].filter((n) => !uniwindNodes.has(n)).length
        if (missing || extra) failures.push(`step ${i} collectAncestors vs Uniwind collectHostNodes: missing ${missing}, extra ${extra}`)
        for (const seed of [1, 2, 3]) {
            const got = tagsOf((visit) => Fiber.collectVisibleAncestors(shuffle(hosts, seed), visit))
            if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`step ${i} ${JSON.stringify(step)} seed ${seed}: ${got} vs ${expected}`)
        }
        const todayTags = unistylesToday(hosts)
        if (JSON.stringify(todayTags) !== JSON.stringify(expected)) {
            const fallbackTag = instances.has('fallback') ? Fiber.getNativeTag(Fiber.getHostFor(instances.get('fallback'))!) : undefined
            const missing = expected.filter((t) => !todayTags.includes(t)).map((t) => (t === fallbackTag ? `${t}(fallback)` : t))
            const extra = todayTags.filter((t) => !expected.includes(t))
            today.push(`step ${i} ${JSON.stringify(step)} missing [${missing}] extra [${extra}]`)
        }
    }

    return { failures, today }
}

const SEQUENCES: Record<string, Array<Partial<State>>> = {
    suspense: [{ suspend: true }, {}, { suspend: false }, {}, { suspend: true }, { suspend: false }],
    activity: [{ activity: 'hidden' }, {}, { activity: 'visible' }, {}, { activity: 'hidden' }, { activity: 'visible' }],
    freeze: [{ freeze: true }, {}, { freeze: false }, {}, { freeze: true }, { freeze: false }],
    nested: [{ freeze: true }, { activity: 'hidden' }, { freeze: false }, { activity: 'visible' }, { suspend: true }, { freeze: true }, { suspend: false }, { freeze: false }],
}

for (const [name, steps] of Object.entries(SEQUENCES)) {
    test(`collectVisibleAncestors / collectAncestors = oracles (+ Uniwind collectHostNodes): ${name}`, () => {
        const { failures, today } = run(steps)
        if (today.length) console.log(`# ${name}: today's walk differs at ${today.length}/${steps.length} steps\n#   ${today.join('\n#   ')}`)
        assert.deepEqual(failures, [])
    })
}
