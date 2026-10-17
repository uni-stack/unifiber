// Per-link overhead on 901 views. V8: compare ratios only.
import { createRequire } from 'node:module'
import * as U from '../src/fiber'
import { Fiber } from '../src/index'
import { isHidden } from '../src/host'
import { reanimatedCSSAdapter } from '../src/adapters/reanimated'
import { createOwnerRegistry, type StyleSource } from '../src/adapters/registry'

const require = createRequire(import.meta.url)
const { React, render, View } = require('../test/harness/fabric.cjs')({ mode: 'production' })
const h = React.createElement

const refs: Array<any> = []
render(h(View, { ref: (r: any) => refs.push(r) }, ...Array.from({ length: 900 }, (_, i) => h(View, { key: i, style: { flex: 1 }, ref: (r: any) => refs.push(r) }))))
const source: StyleSource = { name: 's', epoch: () => 0, resolve: () => undefined }
const registry = createOwnerRegistry(source, [reanimatedCSSAdapter])
const weak = new WeakMap()
let sink = 0

const cases: Record<string, () => void> = {
    'hostFiberOf only (baseline)': () => {
        for (const r of refs) sink += U.hostFiberOf(r) ? 1 : 0
    },
    '+ registry.link (collapsable gate)': () => {
        for (const r of refs) registry.link(Fiber.getHostFor(r))
    },
    '+ unconditional walk to class/host': () => {
        for (const r of refs) {
            let current = (U.hostFiberOf(r) as any)?.return
            while (current && current.tag !== U.Tag.ClassComponent && current.tag !== U.Tag.HostComponent) current = current.return
            sink += current ? 1 : 0
        }
    },
    '+ isHidden walk (to root)': () => {
        for (const r of refs) sink += isHidden(U.hostFiberOf(r) as any) ? 1 : 0
    },
    '+ WeakMap set+delete per link': () => {
        for (const r of refs) {
            const f = U.hostFiberOf(r)
            weak.set(r, f)
            weak.delete(r)
        }
    },
}
const time = (fn: () => void, n: number) => {
    const start = process.hrtime.bigint()
    for (let i = 0; i < n; i++) fn()
    return Number(process.hrtime.bigint() - start) / 1e6 / n
}
for (const fn of Object.values(cases)) time(fn, 2000) // warm up
const results: Record<string, Array<number>> = {}
for (let round = 0; round < 15; round++) {
    const order = round % 2 ? Object.keys(cases).reverse() : Object.keys(cases)
    for (const name of order) (results[name] ??= []).push(time(cases[name]!, 500))
}
const median = (xs: Array<number>) => xs.sort((a, b) => a - b)[xs.length >> 1]!
const base = median(results['hostFiberOf only (baseline)']!)
console.log(`${refs.length} host fibers, ms per pass (median of 15), delta vs baseline`)
for (const [name, xs] of Object.entries(results)) {
    const m = median(xs)
    console.log(`${name.padEnd(40)} ${m.toFixed(4)}  ${name.includes('baseline') ? '' : '+' + (m - base).toFixed(4)}`)
}
if (sink < 0) console.log(sink)
