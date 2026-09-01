/**
 * Types and a lenient parser for the JSON document produced by
 * `opencode-quota show --json`, per
 * `@slkiser/opencode-quota/dist/lib/quota-export.js`.
 *
 * The parser trusts nothing: an unexpected shape anywhere in a single
 * provider degrades that provider to "unavailable" rather than failing the
 * whole read, since a partially-broken export is still more useful than a
 * hard failure, and this is a third-party, disk-cached document with no
 * schema guarantee.
 */

export interface QuotaExportEntry {
	name: string
	window?: string
	resetAt?: number
	renderType: "percent" | "value"
	percentRemaining?: number
	value?: string
}

export interface QuotaExportError {
	label: string
	message: string
}

export type QuotaProviderStatus =
	| { status: "unavailable" }
	| { status: "ok"; fetchedAt: number; entries: QuotaExportEntry[] }
	| { status: "partial"; fetchedAt: number; entries: QuotaExportEntry[]; errors: QuotaExportError[] }
	| { status: "error"; fetchedAt: number; error: string }

export interface QuotaExport {
	exportedAt: number
	cacheAgeSeconds: number
	providers: Record<string, QuotaProviderStatus>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value)
}

function parseEntry(raw: unknown): QuotaExportEntry | undefined {
	if (!isRecord(raw) || typeof raw.name !== "string") return undefined
	const window = typeof raw.window === "string" ? raw.window : undefined
	const resetAt = isFiniteNumber(raw.resetAt) ? raw.resetAt : undefined

	if (raw.renderType === "value" && typeof raw.value === "string") {
		return { name: raw.name, window, resetAt, renderType: "value", value: raw.value }
	}
	if (raw.renderType === "percent" && isFiniteNumber(raw.percentRemaining)) {
		return { name: raw.name, window, resetAt, renderType: "percent", percentRemaining: raw.percentRemaining }
	}
	return undefined
}

function parseError(raw: unknown): QuotaExportError | undefined {
	if (!isRecord(raw) || typeof raw.label !== "string" || typeof raw.message !== "string") return undefined
	return { label: raw.label, message: raw.message }
}

function parseProviderStatus(raw: unknown): QuotaProviderStatus {
	if (!isRecord(raw)) return { status: "unavailable" }

	if (raw.status === "error" && isFiniteNumber(raw.fetchedAt) && typeof raw.error === "string") {
		return { status: "error", fetchedAt: raw.fetchedAt, error: raw.error }
	}

	if ((raw.status === "ok" || raw.status === "partial") && isFiniteNumber(raw.fetchedAt) && Array.isArray(raw.entries)) {
		const entries = raw.entries.map(parseEntry).filter((entry): entry is QuotaExportEntry => entry !== undefined)
		if (raw.status === "ok") return { status: "ok", fetchedAt: raw.fetchedAt, entries }

		const errors = Array.isArray(raw.errors)
			? raw.errors.map(parseError).filter((error): error is QuotaExportError => error !== undefined)
			: []
		return { status: "partial", fetchedAt: raw.fetchedAt, entries, errors }
	}

	return { status: "unavailable" }
}

/**
 * Parses the raw JSON emitted by `opencode-quota show --json` into
 * `QuotaExport`. Throws only when the document is not recognizable as an
 * export at all (not an object, or missing `providers`); everything more
 * granular degrades per-provider instead. Callers should still treat this as
 * fallible and catch around it.
 */
export function parseQuotaExport(raw: unknown): QuotaExport {
	if (!isRecord(raw) || !isRecord(raw.providers)) {
		throw new Error("unrecognized opencode-quota export JSON (missing providers object)")
	}
	if (!isFiniteNumber(raw.exportedAt) || !isFiniteNumber(raw.cacheAgeSeconds)) {
		throw new Error("unrecognized opencode-quota export JSON (missing exportedAt/cacheAgeSeconds)")
	}

	const providers: Record<string, QuotaProviderStatus> = {}
	for (const [providerId, value] of Object.entries(raw.providers)) {
		providers[providerId] = parseProviderStatus(value)
	}

	return { exportedAt: raw.exportedAt, cacheAgeSeconds: raw.cacheAgeSeconds, providers }
}
