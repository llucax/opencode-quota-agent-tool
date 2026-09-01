# opencode-quota-agent-tool

An [opencode](https://opencode.ai) plugin that reports remaining provider quota
to agents, so they can pick a provider when spawning a session or subagent.

## Why this exists

[`@slkiser/opencode-quota`](https://github.com/slkiser/opencode-quota) shows
quota in the TUI, but its `quota_status` tool deliberately returns nothing to
the model: `execute` returns `""` and the report goes into the session via
`injectRawOutput` with `ignored: true` and `noReply: true`, which opencode
keeps out of future model context. "Zero context window pollution" is the
package's own headline claim. That is the right call for a human-facing
status line, and the wrong one for an agent that needs to read the numbers to
decide which provider to route work to.

This plugin adds that missing surface. It registers one tool, `quota`, that
shells out to the already-installed `opencode-quota` CLI (`show --json`),
reads its cached, already-fetched provider data, and returns it as text the
model actually sees:

```
quota, cached 4m ago
anthropic       5h 83% (4h19m), weekly 90% (6d)
github-copilot  premium 100% (29d)
openai          5h 100% (3h13m), weekly 84% (5d)
```

Provider IDs are opencode's, not the quota package's (`copilot` becomes
`github-copilot`), so the output is directly usable for routing. Percentages
always read as remaining, regardless of `opencode-quota`'s own
`percentDisplayMode` setting: a tool an agent routes on needs one unambiguous
answer, not a display preference that silently flips what a bare percentage
means. Reset times are humanized deltas, not timestamps, and the header always
states the cache age so an agent can discount stale numbers on its own.

It makes no network requests of its own; all fetching is the CLI's business,
and it never writes to or deletes anything under
`~/.cache/opencode/quota-provider-state/`, since `opencode-quota` deletes
cache entries on a `packageVersion` mismatch and a second writer at a
different version would wipe the real one's cache.

An optional `refresh` argument runs the plain (non-JSON) `show` first, for its
side effect of repopulating the cache, before reading `show --json`. Be aware
that `opencode-quota` itself throttles refetches to its own `minIntervalMs`
(5 minutes by default) and exposes no way to force past that, so `refresh`
means "refetch anything older than that interval," not a hard force.

## Installing

This plugin needs `@slkiser/opencode-quota` installed and already working
(configured, authenticated, and showing quota in the TUI); it only reads that
package's cache, it does not fetch anything on its own.

Once that's confirmed:

```sh
git clone https://github.com/llucax/opencode-quota-agent-tool
cd opencode-quota-agent-tool
npm install
ln -sfn "$PWD/src/plugin.ts" ~/.config/opencode/plugins/opencode-quota-agent-tool.ts
```

Restart opencode. Module resolution follows the symlink's real path, so
`@opencode-ai/plugin` is resolved from this repo's own `node_modules`; running
`npm install` here first is required, not optional.

## Development

```sh
npm install
npm run check   # typecheck + unit tests
```

The path resolution (`src/cli-path.ts`) and the output formatting
(`src/format.ts`) are plain, side-effect-light functions with their own unit
tests, callable and testable without loading the plugin into opencode at all.
`src/plugin.ts`, the file actually symlinked into opencode, only wires them
together and must keep a single default export: opencode's plugin loader
iterates every export in a loaded file and treats each one as a plugin
factory, throwing on the first one that is not a function, so a second named
export there would take the whole file's tool down, silently.
