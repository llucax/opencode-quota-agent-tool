import type { QuotaExport, QuotaExportEntry } from "./quota-export.ts"
import { entrySpare, providerSpare, sortProvidersBySpare } from "./pace.ts"

/**
 * The one known mismatch between opencode-quota's provider IDs and
 * opencode's own. Output is meant to be directly usable for routing, so IDs
 * print as opencode's, never the quota package's.
 */
export const PROVIDER_ID_MAP: Record<string, string> = {
	copilot: "github-copilot",
}

const DEFAULT_STALE_THRESHOLD_SECONDS = 30 * 60

/** Trailing words on an entry name that carry no information once shortened. */
const GENERIC_NAME_SUFFIXES = new Set(["interactions", "requests", "request", "quota", "limit", "limits", "usage", "tokens"])

export interface FormatQuotaOptions {
	/** Age past which the header calls the cache out as stale. Defaults to 30 minutes. */
	staleThresholdSeconds?: number
	/** Current time in unix seconds, injectable for tests. Defaults to Date.now(). */
	nowSeconds?: number
	providerIdMap?: Record<string, string>
}

function formatDurationShort(totalSeconds: number): string {
	const totalMinutes = Math.max(0, Math.round(totalSeconds / 60))
	if (totalMinutes < 1) return "<1m"
	if (totalMinutes < 60) return `${totalMinutes}m`
	const totalHours = Math.floor(totalMinutes / 60)
	if (totalHours < 24) {
		const minutes = totalMinutes % 60
		return minutes > 0 ? `${totalHours}h${minutes}m` : `${totalHours}h`
	}
	const days = Math.floor(totalHours / 24)
	return `${days}d`
}

/**
 * Deltas under an hour read as a bare "50m" too easily for a percentage's
 * trailing parenthetical, so those get an explicit "resets in" instead. An
 * already-past reset (a stale cache outliving its own window) says so rather
 * than printing a negative duration.
 */
function formatResetPart(deltaSeconds: number): string {
	if (deltaSeconds <= 0) return "resets any moment"
	const short = formatDurationShort(deltaSeconds)
	return deltaSeconds < 3600 ? `resets in ${short}` : short
}

/**
 * Derives a short label for an entry with no `window` field, by dropping a
 * leading word that just echoes the provider (e.g. "Copilot" in "Copilot
 * Premium Interactions") and trailing generic unit words. Falls back to the
 * full name, lowercased, if that leaves nothing.
 */
function shortenEntryName(name: string, providerId: string): string {
	let words = name.split(/\s+/).filter(Boolean)
	if (words.length > 1 && words[0]!.toLowerCase() === providerId.toLowerCase()) {
		words = words.slice(1)
	}
	while (words.length > 1 && GENERIC_NAME_SUFFIXES.has(words[words.length - 1]!.toLowerCase())) {
		words = words.slice(0, -1)
	}
	const shortened = words.join(" ").toLowerCase()
	return shortened || name.toLowerCase()
}

/**
 * Percentages always read as remaining, never "used". A tool meant for an
 * agent to route on has one unambiguous answer; a display preference that
 * silently flips what a bare "21%" means is a footgun a human reading a bar
 * chart can shrug off and an agent cannot.
 */
function formatSigned(value: number): string {
	const rounded = Math.round(value)
	return rounded >= 0 ? `+${rounded}` : `${rounded}`
}

function formatEntry(entry: QuotaExportEntry, providerId: string, nowSeconds: number): string {
	const label = entry.window ? entry.window.toLowerCase() : shortenEntryName(entry.name, providerId)
	const value = entry.renderType === "value" ? entry.value! : `${Math.round(entry.percentRemaining!)}%`
	const resetPart = entry.resetAt !== undefined ? formatResetPart(entry.resetAt - nowSeconds) : undefined
	const base = resetPart ? `${label} ${value} (${resetPart})` : `${label} ${value}`
	const spare = entrySpare(entry, nowSeconds)
	const withSpare = spare === undefined ? base : `${base} ${formatSigned(spare)}`
	const blocked = entry.renderType === "percent" && entry.percentRemaining === 0 && entry.resetAt !== undefined && entry.resetAt > nowSeconds
	return blocked ? `${withSpare} BLOCKED` : withSpare
}

function formatHeader(cacheAgeSeconds: number, staleThresholdSeconds: number): string {
	const age = formatDurationShort(cacheAgeSeconds)
	const stale =
		cacheAgeSeconds > staleThresholdSeconds ? ` (stale, over ${formatDurationShort(staleThresholdSeconds)} old)` : ""
	return `quota, cached ${age} ago${stale}; spare = remaining% - time-left%, provider = lowest window`
}

/**
 * Renders the signed-off tool output from a parsed `opencode-quota show
 * --json` document: one header line with cache age, then one line per
 * provider that has data. `unavailable` providers are omitted entirely, as
 * is any provider whose rendered text comes out empty: `buildQuotaExport`
 * classifies zero entries and zero errors as `ok`, not `error`, so a bare
 * padded ID with nothing after it is a real shape this must not print, since
 * an agent would read a blank value as "no quota left" rather than "no
 * data". `error` providers print their message alone; `partial` providers
 * print their entries followed by the error.
 */
export function formatQuotaOutput(data: QuotaExport, options: FormatQuotaOptions = {}): string {
	const staleThresholdSeconds = options.staleThresholdSeconds ?? DEFAULT_STALE_THRESHOLD_SECONDS
	const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000)
	const providerIdMap = options.providerIdMap ?? PROVIDER_ID_MAP

	const header = formatHeader(data.cacheAgeSeconds, staleThresholdSeconds)

	const rows: { id: string; text: string; spare: number | undefined }[] = []
	for (const [quotaProviderId, status] of Object.entries(data.providers)) {
		if (status.status === "unavailable") continue
		const opencodeId = providerIdMap[quotaProviderId] ?? quotaProviderId

		let text: string
		if (status.status === "error") {
			text = status.error
		} else {
			const entryText = status.entries.map((entry) => formatEntry(entry, quotaProviderId, nowSeconds)).join(", ")
			if (status.status === "partial") {
				const errorText = status.errors.map((error) => error.message).join("; ")
				text = errorText ? [entryText, errorText].filter(Boolean).join(", ") : entryText
			} else {
				text = entryText
			}
		}

		if (!text) continue
		rows.push({ id: opencodeId, text, spare: providerSpare(status, nowSeconds) })
	}

	if (!rows.length) return `${header}\nNo provider data available.`

	const sortedRows = sortProvidersBySpare(rows)
	const idWidth = Math.max(...sortedRows.map((row) => row.id.length)) + 2
	const lines = [
		header,
		...sortedRows.map((row) => {
			const pace = (row.spare === undefined ? "" : `spare ${formatSigned(row.spare)}`).padEnd(12)
			return `${row.id.padEnd(idWidth)}${pace}${row.text}`
		}),
	]
	return lines.join("\n")
}
