import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { type ConfigLike, resolveQuotaCliPath } from "./cli-path.ts"
import { formatQuotaOutput } from "./format.ts"
import { parseQuotaExport } from "./quota-export.ts"
import { runQuotaShow, runQuotaShowJson } from "./run-cli.ts"

/**
 * A file loaded as an opencode plugin must export only plugin factories: the
 * loader iterates every export and throws on the first one that is not a
 * function, taking every tool in the file down with it. Keep this file to
 * the single default export; put anything else in an imported module.
 */
export default (async () => {
	let cachedPath: string | undefined
	let lastConfig: ConfigLike = {}

	async function resolvePath(): Promise<string | undefined> {
		if (cachedPath) return cachedPath
		cachedPath = await resolveQuotaCliPath(lastConfig)
		return cachedPath
	}

	function percentDisplayMode(): "remaining" | "used" {
		const mode = (lastConfig as { experimental?: { quotaToast?: { percentDisplayMode?: unknown } } }).experimental
			?.quotaToast?.percentDisplayMode
		return mode === "used" ? "used" : "remaining"
	}

	return {
		config: async (config) => {
			lastConfig = config
		},

		tool: {
			quota: tool({
				description:
					"Provider quota remaining, from opencode-quota's cache, by opencode provider ID with reset times. Use before spawning to pick a provider. refresh refetches entries older than ~5min only; no hard force exists.",
				args: {
					refresh: tool.schema
						.boolean()
						.optional()
						.describe(
							"Refetch quota entries older than opencode-quota's own refresh interval (5min by default) before reading. Not a hard force: the CLI exposes none.",
						),
				},
				async execute(args) {
					try {
						const cliPath = await resolvePath()
						if (!cliPath) {
							return "quota: could not find the installed @slkiser/opencode-quota CLI (checked the opencode config plugin entries and ~/.cache/opencode/packages)."
						}

						if (args.refresh) {
							// Best-effort cache nudge; its own failure must not block the read below.
							await runQuotaShow(cliPath).catch(() => {})
						}

						const raw = await runQuotaShowJson(cliPath)
						const data = parseQuotaExport(JSON.parse(raw))
						return formatQuotaOutput(data, { percentDisplayMode: percentDisplayMode() })
					} catch (error) {
						// The resolved path may be stale (upgrade, uninstall); re-resolve next call.
						cachedPath = undefined
						const message = error instanceof Error ? error.message : String(error)
						return `quota: ${message.split("\n")[0]}`
					}
				},
			}),
		},
	}
}) satisfies Plugin
