// isHidden vs today's walk on a deep frozen-then-thawed screen. V8.
import { createRequire } from 'node:module'
import { isHidden } from '../src/host'
import { Fiber } from '../src/index'

const require = createRequire(import.meta.url)
const { React, render, View } = require('../test/harness/fabric.cjs')({ mode: 'production' })
const h = React.createElement
const { Freeze } = require(require('../test/harness/paths.cjs').REACT_FREEZE)

const DEPTH = Number(process.env.DEPTH ?? 200)
const Wrap = ({ d, children }: any) => (d === 0 ? children : h(Wrap, { d: d - 1 }, h(View, null, children)))
let instance: any
const leaves = (n: number) => Array.from({ length: 100 }, (_, i) => h(View, { key: i, ref: (r: any) => r && i === 0 && (instance = r), n }))
const app = (freeze: boolean, n: number) => h(Wrap, { d: DEPTH / 2 }, h(Freeze, { freeze }, h(Wrap, { d: DEPTH / 2 }, ...leaves(n))))
const tag = render(app(false, 0))
const host = Fiber.getHostFor(instance)!
const creation = instance.__internalInstanceHandle
const today = (fiber: any) => {
    for (let c = fiber?.return; c; c = c.return) if ((c.tag === 13 || c.tag === 22) && c.memoizedState !== null) return true
    return false
}
const time = (name: string, fn: () => unknown) => {
    for (let i = 0; i < 2000; i++) fn()
    const runs: Array<number> = []
    for (let r = 0; r < 11; r++) {
        const t = performance.now()
        for (let i = 0; i < 20000; i++) fn()
        runs.push(((performance.now() - t) * 1e6) / 20000)
    }
    console.log(`${name.padEnd(36)} ${runs.sort((a, b) => a - b)[5]!.toFixed(0).padStart(6)} ns  -> ${fn()}`)
}
console.log(`depth ~${DEPTH * 2 + 4} fibers`)
time('never toggled: today', () => today(creation))
time('never toggled: isHidden(host)', () => isHidden(host))
render(app(true, 1), tag)
render(app(false, 2), tag)
time('frozen+thawed: today', () => today(creation))
time('frozen+thawed: isHidden(host)', () => isHidden(host))
render(app(true, 3), tag)
time('frozen: isHidden(host)', () => isHidden(host))
