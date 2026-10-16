// Unistyles' real wrappers and registry JS, after rn.cjs. Stubbed: Nitro (records native calls), StyleSheet's listener.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const Module = require('module')

const { UNISTYLES, BABEL_PRESET: PRESET_DIR, BABEL_CORE: BABEL, BABEL_RUNTIME } = require('./paths.cjs')
const SRC = path.join(UNISTYLES, 'src')

module.exports = ({ platform = 'ios', mode = 'development' } = {}) => {
    const babel = require(BABEL)
    const preset = require(PRESET_DIR)
    const cacheDir = path.join(os.tmpdir(), 'unifiber-unistyles-cache', crypto.createHash('sha1').update(SRC).digest('hex').slice(0, 8), `${platform}-${mode}`)
    fs.mkdirSync(cacheDir, { recursive: true })

    const calls = []
    let scopedTheme
    let committedHandles = []
    const registry = {
        link: (node, styles) => calls.push({ op: 'link', node, styles }),
        unlink: (node) => calls.push({ op: 'unlink', node }),
        suspend: (node) => calls.push({ op: 'suspend', node }),
        flush: () => {},
        setScopedTheme: (name) => (scopedTheme = name),
        getScopedTheme: () => scopedTheme,
        verify: () => ({}),
        takeCommittedInstanceHandles: () => {
            const handles = committedHandles
            committedHandles = []
            return handles
        },
        refreshReactNodes: (nodes) => calls.push({ op: 'refreshReactNodes', nodes }),
    }
    const changeListeners = []
    const stubs = {
        nitro: { NitroModules: { createHybridObject: (name) => (name === 'UnistylesShadowRegistry' ? registry : {}) } },
        styleSheet: { StyleSheet: { addChangeListener: (fn) => (changeListeners.push(fn), () => {}) } },
    }
    globalThis.__unifiberUnistylesStubs = stubs

    const stubFile = (name, code) => {
        const file = path.join(cacheDir, `${name}.cjs`)
        fs.writeFileSync(file, code)
        return file
    }
    const NITRO = stubFile('nitro', 'module.exports = globalThis.__unifiberUnistylesStubs.nitro\n')
    const STYLESHEET = stubFile('stylesheet', 'module.exports = globalThis.__unifiberUnistylesStubs.styleSheet\n')
    const SPECS = stubFile('specs', `module.exports = { UnistylesShadowRegistry: require(${JSON.stringify(path.join(SRC, 'specs', 'ShadowRegistry', 'index.ts'))}).UnistylesShadowRegistry }\n`)
    const CORE = stubFile(
        'core',
        `const core = ${JSON.stringify(path.join(SRC, 'core'))}
module.exports = {
    createUnistylesElement: require(core + '/createUnistylesElement').createUnistylesElement,
    createUnistylesActivityIndicator: require(core + '/createUnistylesActivityIndicator').createUnistylesActivityIndicator,
    createUnistylesImageBackground: require(core + '/createUnistylesImageBackground').createUnistylesImageBackground,
    createUnistylesTouchableHighlight: require(core + '/createUnistylesTouchableHighlight').createUnistylesTouchableHighlight,
    passForwardedRef: require(core + '/passForwardRef').passForwardedRef,
}
`,
    )

    const inUnistyles = (file) => typeof file === 'string' && file.startsWith(SRC + path.sep)
    const exts = [`.${platform}.tsx`, '.native.tsx', '.tsx', `.${platform}.ts`, '.native.ts', '.ts']

    const originalResolve = Module._resolveFilename
    Module._resolveFilename = function (request, parent, isMain, options) {
        if (request === 'react-native-nitro-modules') return NITRO
        if (request.startsWith('@babel/runtime/')) return require.resolve(path.join(BABEL_RUNTIME, request.slice('@babel/runtime/'.length)))
        const fromUnistyles = inUnistyles(parent?.filename) && request.startsWith('.')
        if (fromUnistyles || (path.isAbsolute(request) && request.startsWith(SRC + path.sep) && !path.extname(request))) {
            const target = fromUnistyles ? path.resolve(path.dirname(parent.filename), request) : request
            if (target === path.join(SRC, 'specs')) return SPECS
            if (target === path.join(SRC, 'core')) return CORE
            if (target === path.join(SRC, 'specs', 'StyleSheet')) return STYLESHEET
            for (const ext of exts) {
                if (fs.existsSync(target + ext)) return target + ext
            }
            for (const ext of exts) {
                if (fs.existsSync(path.join(target, 'index' + ext))) return path.join(target, 'index' + ext)
            }
        }
        return originalResolve.call(this, request, parent, isMain, options)
    }

    const transform = (originalLoader) =>
        function (module, filename) {
            if (!inUnistyles(filename)) {
                return originalLoader.call(this, module, filename)
            }
            const source = fs.readFileSync(filename, 'utf8')
            const key = crypto.createHash('sha1').update(filename).update(source).digest('hex')
            const cached = path.join(cacheDir, `${key}.js`)
            let code
            if (fs.existsSync(cached)) {
                code = fs.readFileSync(cached, 'utf8')
            } else {
                code = babel.transformSync(source, {
                    filename,
                    babelrc: false,
                    configFile: false,
                    presets: [[preset, { dev: mode === 'development' }]],
                }).code
                // atomic: parallel test processes share this cache
            const temp = `${cached}.${process.pid}.tmp`
            fs.writeFileSync(temp, code)
            fs.renameSync(temp, cached)
            }
            module._compile(code, filename)
        }
    Module._extensions['.tsx'] = transform(Module._extensions['.js'])
    Module._extensions['.ts'] = transform(Module._extensions['.ts'] ?? Module._extensions['.js'])

    const native = (name) => require(path.join(SRC, 'components', 'native', name))
    const components = {
        View: native('View').View,
        Text: native('Text').Text,
        Image: native('Image').Image,
        ImageBackground: native('ImageBackground').ImageBackground,
        TextInput: native('TextInput').TextInput,
        Switch: native('Switch').Switch,
        ScrollView: native('ScrollView').ScrollView,
        FlatList: native('FlatList').FlatList,
        SectionList: native('SectionList').SectionList,
        VirtualizedList: native('VirtualizedList').VirtualizedList,
        KeyboardAvoidingView: native('KeyboardAvoidingView').KeyboardAvoidingView,
        RefreshControl: native('RefreshControl').RefreshControl,
        ActivityIndicator: native('ActivityIndicator').ActivityIndicator,
        Pressable: native('Pressable').Pressable,
        TouchableOpacity: native('TouchableOpacity').TouchableOpacity,
        TouchableHighlight: native('TouchableHighlight').TouchableHighlight,
        SafeAreaView: native('SafeAreaView').SafeAreaView,
        NativeView: native('NativeView').NativeView,
        NativeText: native('NativeText').NativeText,
        Animated: native('Animated').Animated,
    }
    const ScopedThemeContext = require(path.join(SRC, 'components', 'ScopedThemeContext')).ScopedThemeContext

    return {
        components,
        ScopedThemeContext,
        calls,
        // what C++ would hand back after a native commit (UnistylesRegistry::takeCommittedInstanceHandles)
        setCommittedHandles: (handles) => (committedHandles = handles),
        // StyleSheet's change listener: the real refreshReactNodes
        runChangeListeners: () => changeListeners.forEach((listener) => listener()),
        source: UNISTYLES,
    }
}
