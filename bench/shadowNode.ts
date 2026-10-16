// Design alternatives for ref -> shadow node, benchmarked by bench/get-shadow-node.ts.

export const Kind = {
    Host: 0,
    List: 1, // FlatList, SectionList, VirtualizedList: getScrollResponder() returns ScrollView's augmented host instance
    KeyboardAvoidingView: 2,
    ImageBackground: 3,
    RefreshControl: 4,
    Touchable: 5, // Button on Android: a Touchable class above its host
    ActivityIndicator: 6, // ref is the spinner, style is on the wrapper host above it
} as const
export type Kind = (typeof Kind)[keyof typeof Kind]

type ShadowNode = object

const nodeOfHandle = (handle: any): ShadowNode | undefined => handle?.stateNode?.node

const firstHostBelow = (fiber: any) => {
    while (fiber && fiber.tag !== 5) {
        fiber = fiber.child
    }

    return fiber
}

const hostAbove = (fiber: any) => {
    fiber = fiber?.return

    while (fiber && fiber.tag !== 5) {
        fiber = fiber.return
    }

    return fiber
}

// 1. generic: host fast path, then descend from the composite
export const getShadowNode = (ref: any): ShadowNode | undefined => {
    const handle = ref?.__internalInstanceHandle

    if (handle !== undefined) {
        return handle.stateNode?.node
    }

    return nodeOfHandle(firstHostBelow(ref?._reactInternals))
}

// 2. the caller passes the component kind
export const getShadowNodeOfKind = (ref: any, kind: Kind): ShadowNode | undefined => {
    switch (kind) {
        case Kind.Host:
            return ref?.__internalInstanceHandle?.stateNode?.node
        case Kind.List:
            return nodeOfHandle(ref?.getScrollResponder?.()?.__internalInstanceHandle)
        case Kind.KeyboardAvoidingView:
            return nodeOfHandle(ref?.viewRef?.current?.__internalInstanceHandle)
        case Kind.ImageBackground:
            return nodeOfHandle(ref?._viewRef?.__internalInstanceHandle)
        case Kind.RefreshControl:
            return nodeOfHandle(ref?._nativeRef?.__internalInstanceHandle)
        case Kind.Touchable:
            return nodeOfHandle(firstHostBelow(ref?._reactInternals))
        case Kind.ActivityIndicator:
            return nodeOfHandle(hostAbove(ref?.__internalInstanceHandle))
    }
}

// 3. a resolver picked once per wrapper
const resolvers: Record<Kind, (ref: any) => ShadowNode | undefined> = {
    [Kind.Host]: (ref) => ref?.__internalInstanceHandle?.stateNode?.node,
    [Kind.List]: (ref) => nodeOfHandle(ref?.getScrollResponder?.()?.__internalInstanceHandle),
    [Kind.KeyboardAvoidingView]: (ref) => nodeOfHandle(ref?.viewRef?.current?.__internalInstanceHandle),
    [Kind.ImageBackground]: (ref) => nodeOfHandle(ref?._viewRef?.__internalInstanceHandle),
    [Kind.RefreshControl]: (ref) => nodeOfHandle(ref?._nativeRef?.__internalInstanceHandle),
    [Kind.Touchable]: (ref) => nodeOfHandle(firstHostBelow(ref?._reactInternals)),
    [Kind.ActivityIndicator]: (ref) => nodeOfHandle(hostAbove(ref?.__internalInstanceHandle)),
}
export const shadowNodeResolver = (kind: Kind) => resolvers[kind]

// today's Unistyles findShadowNodeForHandle, for comparison
export const unistylesToday = (handle: any) =>
    handle?.__internalInstanceHandle?.stateNode?.node ??
    handle?.getScrollResponder?.()?.getNativeScrollRef?.()?.__internalInstanceHandle?.stateNode?.node ??
    handle?.getNativeScrollRef?.()?.__internalInstanceHandle?.stateNode?.node ??
    handle?._viewRef?.__internalInstanceHandle?.stateNode?.node ??
    handle?.viewRef?.current?.__internalInstanceHandle?.stateNode?.node ??
    handle?._nativeRef?.__internalInstanceHandle?.stateNode?.node

// 4. a Host class wrapping the fiber
export class Host {
    constructor(readonly fiber: any) {}

    getShadowNode(): ShadowNode | undefined {
        return this.fiber.stateNode?.node
    }

    getParentHost(): Host | undefined {
        const parent = hostAbove(this.fiber)

        return parent ? new Host(parent) : undefined
    }
}

export const getHostFor = (ref: any): Host | undefined => {
    const handle = ref?.__internalInstanceHandle ?? firstHostBelow(ref?._reactInternals)

    return handle ? new Host(handle) : undefined
}

// 5. same object without class syntax, and as a bare literal
function HostFn(this: any, fiber: any) {
    this.fiber = fiber
}
HostFn.prototype.getShadowNode = function (this: any) {
    return this.fiber.stateNode?.node
}
export const getHostForFn = (ref: any): any => {
    const handle = ref?.__internalInstanceHandle ?? firstHostBelow(ref?._reactInternals)

    return handle ? new (HostFn as any)(handle) : undefined
}
export const getHostLiteral = (ref: any): any => {
    const handle = ref?.__internalInstanceHandle ?? firstHostBelow(ref?._reactInternals)

    return handle ? { fiber: handle } : undefined
}

// 6. the fiber itself as the handle (shipped)
export const getHostHandle = (ref: any): any => ref?.__internalInstanceHandle ?? firstHostBelow(ref?._reactInternals)
export const hostShadowNode = (host: any): ShadowNode | undefined => host.stateNode?.node
