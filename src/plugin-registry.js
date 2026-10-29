// Plugin UI entrypoints are discovered at build time. The fixture glob exists
// only in E2E builds; gating it with a compile-time env check keeps test plugin
// code (and its "hello" strings) out of the production bundle.
const pluginModules = import.meta.glob("../plugins/*/ui/index.jsx", {
  eager: true,
});

// Fixtures stay lazy so production Rollup can drop the whole map. E2E builds
// evaluate the loaders before registration; normal builds get an empty map.
const fixtureLoaders =
  import.meta.env.VITE_E2E_FIXTURES === "1"
    ? import.meta.glob("../tests/fixtures/plugins/*/ui/index.jsx")
    : {};

export async function loadUiPluginModules() {
  const modules = { ...pluginModules };
  for (const [key, load] of Object.entries(fixtureLoaders))
    modules[key] = await load();
  return modules;
}
