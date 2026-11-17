#!/usr/bin/env node
// kb-mcp - MCP server (stdio) exposing the knowledge library to Claude Code, Codex and other agents.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { KB, SimilarClaimsError } from '../lib/kb.mjs';
import { CONFIDENCE } from '../lib/store.mjs';

const kb = new KB();

const server = new McpServer({ name: 'knowledge-library', version: '0.1.0' });

const text = (s) => ({ content: [{ type: 'text', text: s }] });
const json = (o) => text(JSON.stringify(o, null, 2));
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

server.registerTool(
  'library_list',
  {
    title: 'List conclusions by filter (no model)',
    description:
      'List live conclusions filtered by domain, tag, confidence and update date - e.g. only verified ones, or only those updated since a date. Cheap: no selector model is called.',
    inputSchema: {
      domains: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      confidence: z.array(z.enum(['verified', 'observed', 'hypothesis'])).optional(),
      since: z.string().optional().describe('YYYY-MM-DD: only entries updated on or after this date'),
      limit: z.number().int().min(1).max(500).optional(),
    },
  },
  async (a) => {
    try {
      const rows = await kb.list(a);
      if (!rows.length) return text('(nothing matches)');
      return text(rows.map((r) => `${r.id} | ${r.updated || '-'} | ${r.confidence} | ${r.claim}`).join('\n'));
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerTool(
  'library_search',
  {
    title: 'Search the knowledge library',
    description:
      'Return the conclusions (id | claim) most relevant to a task. Call this at the start of a task that touches a known domain, then library_read the ids you need.',
    inputSchema: {
      task: z.string().describe('What you are about to do, in one or two sentences'),
      k: z.number().int().min(1).max(50).optional().describe('Max results (default 8)'),
      llm: z.boolean().optional().describe('false = keyword ranking only (no selector model)'),
    },
  },
  async ({ task, k = 8, llm = true }) => {
    try {
      const hits = await kb.search(task, { k, llm });
      if (!hits.length) return text('(no relevant conclusions)');
      return text(hits.map((h) => `${h.id} | ${h.claim}`).join('\n'));
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerTool(
  'library_read',
  {
    title: 'Read entries',
    description: 'Return the full body of one or more entries by id (e.g. "git/0003").',
    inputSchema: { ids: z.array(z.string()).min(1) },
  },
  async ({ ids }) => {
    try {
      const entries = await kb.read(ids);
      return text(
        entries
          .map((e) => `# ${e.id} | ${e.claim}\nconfidence: ${e.confidence}  updated: ${e.updated}\n\n${e.body.trimEnd()}`)
          .join('\n\n---\n\n'),
      );
    } catch (err) {
      return fail(err.message);
    }
  },
);

server.registerTool(
  'library_write',
  {
    title: 'Add or update an entry',
    description:
      'Add a conclusion to the library. Without mode, the call refuses when similar claims exist and returns them; then call again with mode "new", "supersede" (+target), or "update" (+target). Use domain "auto" to let the selector pick a domain. After writing, run `kb sync` (or ask the user to) to back up.',
    inputSchema: {
      domain: z.string().describe('Domain id, or "auto"'),
      claim: z.string().describe('One-sentence conclusion: "When X, do Y because Z"'),
      body: z.string().describe('Markdown body: context, evidence, how to apply'),
      tags: z.array(z.string()).optional(),
      confidence: z.enum(CONFIDENCE).optional(),
      source: z.string().optional().describe('Where this was learned (file, URL, ticket)'),
      mode: z.enum(['new', 'supersede', 'update']).optional(),
      target: z.string().optional().describe('Entry id for supersede/update'),
    },
  },
  async ({ domain, claim, body, tags, confidence, source, mode, target }) => {
    try {
      const rec = await kb.add({ domain, claim, body, tags, confidence: confidence || 'observed', source, mode: mode || 'guard', target });
      return json({ written: rec.id, claim: rec.claim, supersedes: rec.supersedes || null });
    } catch (err) {
      if (err instanceof SimilarClaimsError) {
        return json({ written: null, reason: 'similar claims exist; retry with mode new|supersede|update', similar: err.similar });
      }
      return fail(err.message);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
