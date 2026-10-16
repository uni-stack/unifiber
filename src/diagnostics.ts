import type { RawFiber } from './fiber'
import type { Host } from './host'
import * as host from './host'

// Bound once: Metro's inline requires
const { committedHalf, fiberOf } = host

const styleDiffers = (a: RawFiber, b: RawFiber) => a.memoizedProps?.style !== b.memoizedProps?.style

const flattenInto = (style: unknown, out: Record<string, unknown>) => {
    if (Array.isArray(style)) {
        for (let i = 0; i < style.length; i++) {
            flattenInto(style[i], out)
        }
    } else if (style && typeof style === 'object') {
        Object.assign(out, style)
    }

    return out
}

export type Drift = { key: string; react: unknown; expected: unknown }

// Keys that differ from React's committed props: React re-sends them on the view's next render
export const verify = (host: Host, expected: Record<string, unknown>): Array<Drift> => {
    const baseline = committedHalf(fiberOf(host), styleDiffers) ?? fiberOf(host)
    const react = flattenInto(baseline.memoizedProps?.style, {})
    const drift: Array<Drift> = []

    for (const key in expected) {
        if (react[key] !== expected[key]) {
            drift.push({ key, react: react[key], expected: expected[key] })
        }
    }

    return drift
}

// Development builds only
export const getOwners = (host: Host, max = 8): Array<string> => {
    const owners: Array<string> = []

    for (let owner = fiberOf(host)._debugOwner; owner && owners.length < max; owner = owner._debugOwner ?? owner.owner) {
        const name = owner.name ?? owner.type?.displayName ?? owner.type?.name ?? owner.type?.render?.name

        if (name) {
            owners.push(name)
        }
    }

    return owners
}

// Development builds only
export const getCreationStack = (host: Host): string | undefined => fiberOf(host)._debugStack?.stack
