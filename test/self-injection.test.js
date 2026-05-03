import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "node:test";

const plugins = [
  "gsd-agent-loop",
  "gsd-explicit-reactive",
  "gsd-guardian",
  "gsd-magic-todo",
  "gsd-system-prompt",
];

const importPlugin = async pluginName => {
  const url = new URL(`../${pluginName}/index.js`, import.meta.url);
  url.search = `?t=${Date.now()}`;
  return import(url.href);
};

describe("bundled extension self-injection", () => {
  for (const pluginName of plugins) {
    test(`${pluginName} normalizes existing directory entry to its entry file`, async () => {
      const previous = process.env.GSD_BUNDLED_EXTENSION_PATHS;
      const pluginDir = path.resolve(pluginName);
      const entryFile = path.join(pluginDir, "index.js");

      try {
        process.env.GSD_BUNDLED_EXTENSION_PATHS = pluginDir;
        await importPlugin(pluginName);

        assert.deepEqual(
          process.env.GSD_BUNDLED_EXTENSION_PATHS.split(path.delimiter).filter(Boolean),
          [entryFile],
        );
      } finally {
        if (previous === undefined) delete process.env.GSD_BUNDLED_EXTENSION_PATHS;
        else process.env.GSD_BUNDLED_EXTENSION_PATHS = previous;
      }
    });

    test(`${pluginName} does not append duplicate entry file`, async () => {
      const previous = process.env.GSD_BUNDLED_EXTENSION_PATHS;
      const entryFile = path.resolve(pluginName, "index.js");

      try {
        process.env.GSD_BUNDLED_EXTENSION_PATHS = entryFile;
        await importPlugin(pluginName);

        assert.deepEqual(
          process.env.GSD_BUNDLED_EXTENSION_PATHS.split(path.delimiter).filter(Boolean),
          [entryFile],
        );
      } finally {
        if (previous === undefined) delete process.env.GSD_BUNDLED_EXTENSION_PATHS;
        else process.env.GSD_BUNDLED_EXTENSION_PATHS = previous;
      }
    });
  }
});
