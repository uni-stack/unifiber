<div align="center">

# unifiber

**One small, tested place for everything React Native styling libraries read from React's private fiber tree.**

Built for [Unistyles](https://github.com/jpudysz/react-native-unistyles) and Uniwind Pro.

`React 19` · `React Native 0.86 – 0.87` · `iOS + Android` · `Hermes-first` · `MIT`

</div>

---

## Why this exists

Unistyles and Uniwind both do something React Native doesn't officially support: they update the native shadow tree **without a React render**. Theme switches, breakpoints and insets reach native views in a single commit. To do that, both read React's private fiber fields: `__internalInstanceHandle`, `stateNode.node`, `memoizedState`, `return`, `alternate` and more.

Until now, each library kept its own copy of those reads. They drifted apart, and both had bugs that only show up on real apps.

unifiber is the one module that knows what a fiber looks like. It answers questions such as "which native view is this ref?", "is it hidden, and why?" and "what must refresh?". It's tested against **React Native's own components** and **Unistyles' real code**. A daily CI run against React Native nightly catches changes to React's internals before they ship.

## API

`Fiber` and `Reanimated` are plain objects. A **`Host`** is a native view's creation fiber behind an opaque type: free to keep, and stable, so the same view is always the same `Host` (`===` and `WeakMap` keys work).

### ref → Host
| | |
|---|---|
| `getHostFor(ref)` | Native-view refs, RN composites (ScrollView, FlatList / SectionList / VirtualizedList, ImageBackground, KeyboardAvoidingView, RefreshControl), and class components that render their view directly (Button on Android). Call once per link and keep the result. |
| `getShadowNodeFor(ref)` | Hot path when you don't keep a Host. |
| `getHostForInstanceHandle(handle)` | For fibers handed back from C++ (`ShadowNodeFamily::getInstanceHandle`). |
| `getContentContainerFor(ref)` | ScrollView / list content container, through RN's public `getInnerViewRef()`. |

### Host → native
| | |
|---|---|
| `getShadowNode(host)` | The node in React's `stateNode.node` wrapper. |
| `getShadowNodes(host, out?)` | Every node React may diff against or re-attach: one after a commit, two while a render is in flight. |
| `getNativeTag(host)` | `undefined` once the view has unmounted. |
| `getParentHost(host)` | The nearest native view above (ActivityIndicator's wrapper, on both platforms). |
| `patchRenderedProps(host, patch)` | Replaces React's diff baseline on both halves. **The only write**, used by Uniwind's baseline. |

### Hidden state
| | |
|---|---|
| `isHidden(host)` | Inside a Suspense fallback, a frozen screen or a hidden `<Activity>`: suspend instead of unlinking. Also right inside a ref cleanup, where React has not switched the committed tree yet. |
| `isSuspended` · `isFrozen` · `isInHiddenActivity` | Why. Frozen means react-freeze (react-native-screens `freezeOnBlur`, react-navigation). |
| `collectVisibleAncestors(hosts, visit)` | Batch refresh. Each visible native view from `hosts` up to the root, visited once, in one shared pass. |
| `collectAncestors(hosts, visit)` | The same walk, with hidden views included. These are the semantics of Uniwind's `collectHostNodes` today. |

### Diagnostics
| | |
|---|---|
| `verify(host, expected)` | Style keys React would re-send, i.e. undo, on this view's next render. |
| `getOwners(host)` | *Development builds only:* the components that created the view, e.g. `['ProfileCard', 'ProfileScreen']`. |
| `getCreationStack(host)` | *Development builds only:* where the JSX was written, for Metro to symbolicate. |

### Adapters: when a 3rd-party component owns the view
Reanimated's `AnimatedComponent` keeps its own copy of a view's style for CSS transitions, so a native-only theme change gets overridden. The adapter keeps that copy in sync, so the theme change **animates** instead.

```ts
const owners = Fiber.createOwnerRegistry({
    name: 'unistyles',
    epoch: () => themeVersion,                     // bump on every runtime change
    contexts: [ScopedThemeContext],
    contextKey: (_ctx, scope) => scope?.name,      // stable scopes are renamed in place
    resolve: (props, read) => freshStyles(props, read(ScopedThemeContext)),
}, [Reanimated.cssAdapter], warnOnce)

owners.link(host)        // in the link path: ~86 ns for a plain view
owners.refresh(hosts)    // after a native-only update
```

An adapter that throws is switched off for the session and reported once. Private Reanimated fields are pinned by a contract test against the 4.5.1 and 4.7.0 sources.

## Compatibility

| | |
|---|---|
| React | 19.2, and 19.3.1 with RN nightly (fiber tags pinned for 19.x) |
| React Native | 0.87.1, 0.86.3 · iOS, Android · development and production. CI also runs React Native **nightly** (main) every day; 0.89.0-nightly-20261016 passes |
| Reanimated | 4.5.1, 4.7.0 |
| Unistyles | 3.5.3 and `main` (its real code runs in the suite) |
| Uniwind | its lookups copied verbatim into the suite |
| Engine | Hermes (legacy Hermes benchmarked) |

## License

MIT
