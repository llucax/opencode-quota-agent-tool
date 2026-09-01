# opencode-quota-agent-tool

An [opencode](https://opencode.ai) plugin that reports remaining provider quota
to agents, so they can pick a provider when spawning a session or subagent.

It adds nothing of its own: it reads the cache that
[opencode-quota](https://github.com/slkiser/opencode-quota) already maintains,
which deliberately keeps its output away from the model.

Work in progress.
