// The only module that reads React's fiber fields. A missing field gives undefined / null for that call, never a throw.
import type { Context } from 'react'

// ReactWorkTags, React 19
export const Tag = {
    ClassComponent: 1,
    HostRoot: 3,
    HostComponent: 5,
    ContextProvider: 10,
    Suspense: 13,
    Offscreen: 22,
    Activity: 31,
} as const

declare const brand: unique symbol
export type FiberNode = { readonly [brand]: 'FiberNode' }
export type ShadowNode = { readonly __hostObjectShadowNodeWrapper?: unknown }

export type RawFiber = {
    tag: number
    type: any
    return: RawFiber | null
    child: RawFiber | null
    sibling: RawFiber | null
    alternate: RawFiber | null
    stateNode: any
    memoizedProps: any
    pendingProps: any
    memoizedState: any
    _debugOwner?: any
    _debugStack?: { stack?: string } | null
}

export const raw = (fiber: FiberNode | null | undefined) => fiber as unknown as RawFiber | null | undefined

export const hostFiberOf = (instance: unknown): FiberNode | null =>
    ((instance as any)?.__internalInstanceHandle ?? null) as FiberNode | null

// RN composites that keep their host behind a ref of their own, most common first
const compositeHostRefs: Array<(handle: any) => unknown> = [
    (handle) => handle?.getScrollResponder?.()?.getNativeScrollRef?.(), // FlatList, SectionList, VirtualizedList
    (handle) => handle?.getNativeScrollRef?.(), // ScrollView
    (handle) => handle?._viewRef, // ImageBackground
    (handle) => handle?.viewRef?.current, // KeyboardAvoidingView
    (handle) => handle?._nativeRef, // RefreshControl
]

export const resolveHostFiber = (handle: unknown): FiberNode | null => {
    const direct = hostFiberOf(handle)

    if (direct || !handle) {
        return direct
    }

    for (let i = 0; i < compositeHostRefs.length; i++) {
        const fiber = hostFiberOf(compositeHostRefs[i](handle))

        if (fiber) {
            return fiber
        }
    }

    return null
}

export const fiberOfInstance = (instance: unknown): FiberNode | null =>
    ((instance as any)?._reactInternals ?? null) as FiberNode | null

export const firstHostBelow = (fiber: FiberNode | null): FiberNode | null => {
    let current = raw(fiber)

    while (current && current.tag !== Tag.HostComponent) {
        current = current.child
    }

    return (current ?? null) as FiberNode | null
}

export const hostAncestor = (fiber: FiberNode | null, levels = 1): FiberNode | null => {
    let current = raw(fiber)?.return

    while (current) {
        if (current.tag === Tag.HostComponent && --levels === 0) {
            return current as unknown as FiberNode
        }

        current = current.return
    }

    return null
}

export const shadowNodesOf = (fiber: FiberNode | null, out: Array<ShadowNode>) => {
    const current = raw(fiber)
    const node = current?.stateNode?.node
    const alternateNode = current?.alternate?.stateNode?.node

    if (node) {
        out.push(node)
    }

    if (alternateNode && alternateNode !== node) {
        out.push(alternateNode)
    }
}

const childOfParent = (parent: RawFiber, a: RawFiber, b: RawFiber): RawFiber | null => {
    for (let child = parent.child; child; child = child.sibling) {
        if (child === a || child === b) {
            return child
        }
    }

    return null
}

// React 19.2 findCurrentFiberUsingSlowPath, returning null where React throws
export const committedOf = (fiber: FiberNode | null): FiberNode | null => {
    const self = raw(fiber)

    if (!self) {
        return null
    }

    const alternate = self.alternate

    if (!alternate) {
        let root = self

        while (root.return) {
            root = root.return
        }

        return root.tag === Tag.HostRoot ? fiber : null
    }

    let a: RawFiber = self
    let b: RawFiber = alternate

    while (true) {
        const parentA = a.return

        if (!parentA) {
            break
        }

        const parentB = parentA.alternate

        if (!parentB) {
            const next = parentA.return

            if (next) {
                a = next
                continue
            }

            break
        }

        if (parentA.child === parentB.child) {
            const found = childOfParent(parentA, a, b)

            return found === a ? fiber : found === b ? (alternate as unknown as FiberNode) : null
        }

        if (a.return !== b.return) {
            a = parentA
            b = parentB
        } else {
            const inA = childOfParent(parentA, a, b)
            const inB = inA ? null : childOfParent(parentB, a, b)

            if (!inA && !inB) {
                return null
            }

            const aUnderA = inA ? inA === a : inB !== a

            a = aUnderA ? parentA : parentB
            b = aUnderA ? parentB : parentA
        }

        if (a.alternate !== b) {
            return null
        }
    }

    if (a.tag !== Tag.HostRoot) {
        return null
    }

    return a.stateNode?.current === a ? fiber : (alternate as unknown as FiberNode)
}

// a provider's other half can hold its previous value
const committedProviderValue = (provider: RawFiber): unknown => {
    const alternate = provider.alternate

    if (!alternate || alternate.memoizedProps?.value === provider.memoizedProps?.value) {
        return provider.memoizedProps?.value
    }

    return (raw(committedOf(provider as unknown as FiberNode)) ?? provider).memoizedProps?.value
}

export const readContext = <T>(fiber: FiberNode | null, context: Context<T>, fallback?: T): T | undefined => {
    for (let current = raw(fiber)?.return; current; current = current.return) {
        if (current.tag === Tag.ContextProvider && (current.type === context || current.type?._context === context)) {
            return committedProviderValue(current) as T
        }
    }

    return fallback
}

// Fabric is a secondary renderer: its context stack is `_currentValue2`. Only valid during render.
export const readContextDuringRender = <T>(context: Context<T>): T | undefined =>
    (context as any)?._currentValue2

export type ContextReader = <T>(context: Context<T>) => T | undefined

export const contextReaderFor = (instance: unknown, rendering: boolean): ContextReader =>
    rendering ? readContextDuringRender : (context) => readCommittedContext(instance, context)

const NO_PROVIDER = Symbol('no provider')

const readCommittedContext = <T>(instance: unknown, context: Context<T>): T | undefined => {
    const value = readContext(committedOf(fiberOfInstance(instance)), context, NO_PROVIDER as T)

    return value === NO_PROVIDER ? readContextDuringRender(context) : value
}

// pendingProps too, so React still bails out. Replaced, not mutated: props are frozen in dev.
export const patchRenderedProps = (
    fiber: FiberNode | null,
    patch: (props: Record<string, any>) => Record<string, any> | undefined,
): boolean => {
    const self = raw(fiber)

    if (!self) {
        return false
    }

    const patchedSelf = replaceProps(self, patch)
    const patchedAlternate = self.alternate ? replaceProps(self.alternate, patch) : false

    return patchedSelf || patchedAlternate
}

const replaceProps = (target: RawFiber, patch: (props: Record<string, any>) => Record<string, any> | undefined) => {
    const props = target.memoizedProps
    const next = props ? patch(props) : undefined

    if (!next) {
        return false
    }

    target.memoizedProps = next
    target.pendingProps = next

    return true
}
