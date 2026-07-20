#!/usr/bin/env node
// scripts/build-shaders.mjs
//
// Finds every src/**/*.wgsl and src/**/*.glsl file and generates a sibling
// <name>.<ext>.ts module that exports its contents as a plain string.
//
// Why: shader source lives in real .wgsl/.glsl files (proper syntax
// highlighting, wgsl-analyzer / GLSL linting), but both build paths need
// to consume it as a normal TS module:
//   - `tsc` (build:esm / build:cjs) doesn't know how to import raw shader files
//   - Rollup could inline it via rollup-plugin-string, but that only
//     covers the bundled outputs, not the unbundled tsc outputs
//
// Generating a real .ts file up front means both build paths just see an
// ordinary TypeScript module — no bundler-specific loader required.
//
// Regenerate manually with `npm run build:shaders`. `npm run build` always
// runs this first.

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = new URL('../src', import.meta.url).pathname;
const SHADER_EXTENSIONS = ['.wgsl', '.glsl'];

function findShaderFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findShaderFiles(full));
    } else if (SHADER_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function toModule(source, sourceFileName) {
  // Escape backslashes, backticks, and ${ so the shader source survives
  // being dropped into a template literal untouched.
  const escaped = source
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');

  return `// AUTO-GENERATED FILE — DO NOT EDIT.
// Source: ${sourceFileName}
// Regenerate with \`npm run build:shaders\`.

const source: string = \`${escaped}\`;

export default source;
`;
}

const files = findShaderFiles(SRC_DIR);

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  const outFile = `${file}.ts`;
  writeFileSync(outFile, toModule(contents, relative(SRC_DIR, file)));
  console.log(`shader: ${relative(SRC_DIR, file)} -> ${relative(SRC_DIR, outFile)}`);
}

console.log(`Built ${files.length} shader module${files.length === 1 ? '' : 's'}.`);