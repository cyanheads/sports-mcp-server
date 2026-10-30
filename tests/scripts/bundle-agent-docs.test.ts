/**
 * @fileoverview Preserve runtime skill modules while stripping package-root agent docs.
 * @module tests/scripts/bundle-agent-docs
 */
import { describe, expect, it } from 'vitest';
import { AGENT_DOC_ENTRY as cleanerPattern } from '../../scripts/clean-mcpb.js';
import { AGENT_DOC_ENTRY as lintPattern } from '../../scripts/lint-packaging.js';

describe('bundle agent docs', () => {
  it.each([
    'node_modules/example/skills/guide/SKILL.md',
    'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
    'node_modules/example/.claude/skills/a/SKILL.md',
    'node_modules/example/.agents/skills/a/SKILL.md',
    'node_modules/example/SKILL.md',
    'node_modules/a/node_modules/@scope/example/skills/guide/SKILL.md',
  ])('strips package-root agent docs: %s', (entry) => {
    expect(cleanerPattern.test(entry)).toBe(true);
    expect(lintPattern.test(entry)).toBe(true);
  });

  it.each([
    'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
    'node_modules/@modelcontextprotocol/server/dist/ext/skills/loaders.js',
    'node_modules/a/node_modules/@modelcontextprotocol/server/dist/ext/skills/index.js',
    'skills/sports-guide/SKILL.md',
    'node_modules/example/dist/SKILL.md',
  ])('preserves runtime modules and published skills: %s', (entry) => {
    expect(cleanerPattern.test(entry)).toBe(false);
    expect(lintPattern.test(entry)).toBe(false);
  });
});
