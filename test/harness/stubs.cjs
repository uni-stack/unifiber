// Fake nativeFabricUIManager and private interface for the Fabric renderer. No Node APIs: also bundled for Hermes.
const install = () => {
    let nodeCount = 0
    const ops = [] // clone log, so a test can see what React diffed
    const committed = new Map() // rootTag -> children of the last completeRoot
    const node = (family, props, children) => ({ id: ++nodeCount, family, props, children, promoted: false })
    const merge = (props, payload) => (payload ? { ...props, ...payload } : props)

    // unknown methods are no-ops, so newer renderers (eg. RN 0.89's View Transitions) still run
    const lenient = (target) =>
        new Proxy(target, {
            get: (object, key) => (key in object || typeof key === 'symbol' || key === 'then' ? object[key] : () => undefined),
        })

    globalThis.nativeFabricUIManager = {
        createNode: (tag, viewName, rootTag, props, instanceHandle) =>
            node({ tag, viewName, rootTag, instanceHandle }, props, []),
        cloneNodeWithNewChildren: (n) => node(n.family, n.props, []),
        cloneNodeWithNewProps: (n, payload) => (ops.push({ op: 'props', tag: n.family.tag, payload }), node(n.family, merge(n.props, payload), n.children)),
        cloneNodeWithNewChildrenAndProps: (n, payload) => (ops.push({ op: 'childrenAndProps', tag: n.family.tag, payload }), node(n.family, merge(n.props, payload), [])),
        createChildSet: () => [],
        appendChild: (parent, child) => parent.children.push(child),
        appendChildToSet: (set, child) => set.push(child),
        completeRoot: (rootTag, set) => {
            const promote = (n) => {
                n.promoted = true
                n.children.forEach(promote)
            }
            set.forEach(promote)
            committed.set(rootTag, set)
        },
        registerEventHandler: () => {},
        unstable_DiscreteEventPriority: 2,
        unstable_ContinuousEventPriority: 8,
        unstable_IdleEventPriority: 536870912,
        unstable_getCurrentEventPriority: () => 32,
        measure: () => {},
        setIsJSResponder: () => {},
        dispatchCommand: () => {},
        sendAccessibilityEvent: () => {},
        findNodeAtPoint: () => {},
    }

    const viewConfig = (name) => ({ uiViewClassName: name, validAttributes: { style: true, collapsable: true, testID: true, nativeID: true } })
    const flattenStyle = (style) => (Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).map(flattenStyle)) : style ?? undefined)
    const payload = (props) => {
        const out = {}
        for (const key in props) {
            if (key !== 'children' && typeof props[key] !== 'function') {
                out[key] = key === 'style' ? flattenStyle(props[key]) : props[key]
            }
        }
        return out
    }
    class ReactNativeElement {
        constructor(tag, config, internalInstanceHandle) {
            this.__nativeTag = tag
            this.__viewConfig = config
            this.__internalInstanceHandle = internalInstanceHandle
        }
    }
    const privateInterface = {
        ReactNativeViewConfigRegistry: { get: viewConfig, register: () => {} },
        createAttributePayload: payload,
        diffAttributePayloads: (prev, next) => {
            const a = payload(prev)
            const b = payload(next)
            const diff = {}
            let changed = false
            for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
                if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
                    diff[key] = b[key] ?? null
                    changed = true
                }
            }
            return changed ? diff : null
        },
        createPublicInstance: (tag, config, handle) => new ReactNativeElement(tag, config, handle),
        createPublicRootInstance: (rootTag) => ({ rootTag }),
        createPublicTextInstance: (handle) => ({ __internalInstanceHandle: handle }),
        getNativeTagFromPublicInstance: (i) => i.__nativeTag,
        getNodeFromPublicInstance: (i) => i.__internalInstanceHandle?.stateNode?.node,
        getInternalInstanceHandleFromPublicInstance: (i) => i.__internalInstanceHandle,
        deepFreezeAndThrowOnMutationInDev: () => {},
        legacySendAccessibilityEvent: () => {},
        RawEventEmitter: { emit: () => {} },
        ReactFiberErrorDialog: { showErrorDialog: () => true },
        UIManager: {},
    }

    globalThis.nativeFabricUIManager = lenient(globalThis.nativeFabricUIManager)
    // RN 0.89+ reads the UI manager from the private interface
    privateInterface.fabricUIManager = globalThis.nativeFabricUIManager
    const lenientInterface = lenient(privateInterface)

    globalThis.__unifiberPrivateInterface = lenientInterface
    return { privateInterface: lenientInterface, ops, committed }
}

module.exports = { install }
