import {
  Component,
  Suspense,
  lazy,
  useSyncExternalStore,
} from "react";

// Fixed shell extension points. A plugin may only contribute to these names,
// which keeps the shell in control of placement and the plugin surface small.
export const SLOTS = [
  "patient.tabs",
  "patient.overviewCards",
  "patient.actions",
  "agenda.sources",
  "chat.resultCards",
  "proposal.renderers",
  "settings.panels",
  "tools.directory",
];

const KEYED_SLOTS = new Set(["chat.resultCards", "proposal.renderers"]);
const ACTION_SLOT = "patient.actions";
const PLUGIN_ID = /^[a-z][a-z0-9-]{1,39}$/;
const COMPONENT_TYPES = new Set([
  Symbol.for("react.lazy"),
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
]);

// React.lazy/memo/forwardRef are objects, not functions. Treat every valid
// React component type as renderable so the lazy wrapper is not mistaken for a
// missing contribution.
function isComponentType(value) {
  if (typeof value === "function") return true;
  if (!value || typeof value !== "object") return false;
  return COMPONENT_TYPES.has(value.$$typeof);
}

const registrations = new Map();
const listeners = new Set();
const EMPTY = Object.freeze([]);
let enabledIds = new Set();
let slotsByName = new Map();
let version = 0;

function rebuild() {
  const next = new Map();
  for (const definition of registrations.values()) {
    if (!enabledIds.has(definition.id)) continue;
    for (const [name, contributions] of Object.entries(definition.slots)) {
      const list = next.get(name) || [];
      if (Array.isArray(contributions)) list.push(...contributions);
      else list.push(...Object.values(contributions));
      next.set(name, list);
    }
  }
  for (const [name, list] of next) {
    list.sort(
      (a, b) =>
        (a.order ?? 100) - (b.order ?? 100) ||
        a.pluginId.localeCompare(b.pluginId) ||
        String(a.id || a.type).localeCompare(String(b.id || b.type)),
    );
    next.set(name, Object.freeze(list));
  }
  slotsByName = next;
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => version;

// A UI plugin declaration is pure data: ids, labels, order and lazy component
// loaders. React.lazy is created once here so toggling a plugin cannot rebuild
// the component identity (and therefore cannot remount an open panel).
export function defineUiPlugin({ id, slots = {} } = {}) {
  if (typeof id !== "string" || !PLUGIN_ID.test(id))
    throw new Error("插件 UI 的 id 必须匹配 /^[a-z][a-z0-9-]{1,39}$/");
  if (!slots || typeof slots !== "object" || Array.isArray(slots))
    throw new Error(`插件 ${id} 的 slots 必须是对象`);
  const normalized = {};
  for (const [name, value] of Object.entries(slots)) {
    if (!SLOTS.includes(name))
      throw new Error(`插件 ${id} 使用了未知插槽 ${name}`);
    if (KEYED_SLOTS.has(name)) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`插件 ${id} 的插槽 ${name} 必须是 { 类型: 加载函数 }`);
      const keyed = {};
      for (const [type, loader] of Object.entries(value)) {
        if (typeof type !== "string" || !type.trim())
          throw new Error(`插件 ${id} 的插槽 ${name} 缺少类型`);
        if (typeof loader !== "function")
          throw new Error(`插件 ${id} 的插槽 ${name}.${type} 必须是加载函数`);
        keyed[type] = Object.freeze({
          pluginId: id,
          type,
          order: 100,
          component: lazy(loader),
        });
      }
      normalized[name] = Object.freeze(keyed);
      continue;
    }
    if (!Array.isArray(value))
      throw new Error(`插件 ${id} 的插槽 ${name} 必须是贡献数组`);
    if (name === ACTION_SLOT) {
      normalized[name] = Object.freeze(
        value.map((item, index) => {
          if (!item || typeof item !== "object")
            throw new Error(`插件 ${id} 的插槽 ${name}[${index}] 无效`);
          if (typeof item.id !== "string" || !item.id.trim())
            throw new Error(`插件 ${id} 的插槽 ${name}[${index}] 缺少 id`);
          if (typeof item.run !== "function")
            throw new Error(
              `插件 ${id} 的插槽 ${name}.${item.id} 缺少 run 函数`,
            );
          return Object.freeze({
            pluginId: id,
            id: item.id,
            label: item.label || item.id,
            order: Number.isFinite(item.order) ? item.order : 100,
            run: item.run,
          });
        }),
      );
      continue;
    }
    normalized[name] = Object.freeze(
      value.map((item, index) => {
        if (!item || typeof item !== "object")
          throw new Error(`插件 ${id} 的插槽 ${name}[${index}] 无效`);
        if (typeof item.id !== "string" || !item.id.trim())
          throw new Error(`插件 ${id} 的插槽 ${name}[${index}] 缺少 id`);
        if (typeof item.component !== "function")
          throw new Error(
            `插件 ${id} 的插槽 ${name}.${item.id} 缺少 component 加载函数`,
          );
        return Object.freeze({
          pluginId: id,
          id: item.id,
          label: item.label || item.id,
          order: Number.isFinite(item.order) ? item.order : 100,
          component: lazy(item.component),
        });
      }),
    );
  }
  return Object.freeze({ id, slots: Object.freeze(normalized) });
}

// `modules` is the module map produced by plugin-registry.js (production
// entries are eager, E2E fixture entries are materialized before this call).
// Only plugins whose server status is "ready" are registered, so a disabled or
// unavailable plugin never contributes DOM.
export function registerUiPlugins(modules = {}, enabled = []) {
  enabledIds = new Set(
    Array.isArray(enabled) ? enabled : enabled instanceof Set ? enabled : [],
  );
  registrations.clear();
  for (const key of Object.keys(modules).sort()) {
    try {
      const definition = modules[key]?.default ?? modules[key];
      if (!definition?.id) continue;
      // The module factory is evaluated eagerly by import.meta.glob, so an
      // invalid declaration is caught here instead of taking down the shell.
      if (typeof definition.id !== "string") continue;
      registrations.set(definition.id, definition);
    } catch (error) {
      console.error("插件 UI 注册失败:", key, error);
    }
  }
  rebuild();
}

export function useSlot(name) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return slotsByName.get(name) || EMPTY;
}

// Exported so the server-render regression test can exercise the fallback
// directly: React's streaming SSR intentionally defers component errors inside
// a Suspense boundary to client rendering, so it cannot observe this fallback.
export class PluginErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("插件组件渲染失败:", error, info);
  }

  render() {
    if (this.state.error)
      return (
        <p className="plugin-slot-error" role="alert">
          插件组件出错：{this.state.error?.message || "未知错误"}
        </p>
      );
    return this.props.children;
  }
}

// Renders one contribution with its own lazy boundary. It intentionally adds
// no wrapper element: an empty slot produces no DOM at all.
export function SlotItem({ contribution, ...props }) {
  if (!isComponentType(contribution?.component)) return null;
  const Content = contribution.component;
  return (
    <Suspense fallback={null}>
      <PluginErrorBoundary
        key={`${contribution.pluginId}:${contribution.id || contribution.type}`}
      >
        <Content {...props} />
      </PluginErrorBoundary>
    </Suspense>
  );
}

export function Slot({ name, ...props }) {
  const contributions = useSlot(name);
  if (!contributions.length) return null;
  return (
    <>
      {contributions.map((contribution) => (
        <SlotItem
          key={`${contribution.pluginId}:${contribution.id || contribution.type}`}
          contribution={contribution}
          {...props}
        />
      ))}
    </>
  );
}

// chat.resultCards is keyed by artifact type. A missing contribution falls back
// to the fixed shell's original rendering; no wrapper or placeholder is added.
export function ResultCard({ artifact, fallback = null, ...props }) {
  const cards = useSlot("chat.resultCards");
  const contribution = artifact?.type
    ? cards.find((item) => item.type === artifact.type)
    : null;
  if (!contribution)
    return typeof fallback === "function" ? fallback() : fallback;
  return <SlotItem contribution={contribution} artifact={artifact} {...props} />;
}
