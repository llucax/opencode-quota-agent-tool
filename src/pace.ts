import type { QuotaExportEntry, QuotaProviderStatus } from "./quota-export.ts"

const DAY_SECONDS = 24 * 60 * 60

/**
 * Returns a window's full length in seconds when its reset convention makes
 * that length knowable. Calendar months are measured backwards from the reset
 * boundary because assuming 30 days distorts both February and 31-day months.
 */
export function windowLengthSeconds(entry: QuotaExportEntry): number | undefined {
	const window = entry.window?.trim()
	const fixed = window?.match(/^(\d+)([hd])$/i)
	if (fixed) {
		const amount = Number.parseInt(fixed[1]!, 10)
		if (amount <= 0) return undefined
		return amount * (fixed[2]!.toLowerCase() === "h" ? 60 * 60 : DAY_SECONDS)
	}

	if (window?.toLowerCase() === "daily") return DAY_SECONDS
	if (window?.toLowerCase() === "weekly") return 7 * DAY_SECONDS

	const resetAt = entry.resetAt
	if (resetAt === undefined) return undefined
	const reset = new Date(resetAt * 1000)
	const resetsAtMonthBoundary =
		reset.getUTCDate() === 1 &&
		reset.getUTCHours() === 0 &&
		reset.getUTCMinutes() === 0 &&
		reset.getUTCSeconds() === 0 &&
		reset.getUTCMilliseconds() === 0
	const isMonthly = window?.toLowerCase() === "monthly" || (window === undefined && resetsAtMonthBoundary)
	if (!isMonthly) return undefined

	const previousMonthStart = Date.UTC(reset.getUTCFullYear(), reset.getUTCMonth() - 1, 1) / 1000
	return resetAt - previousMonthStart
}

/** Remaining percentage points after reserving quota at an even pace. */
export function entrySpare(entry: QuotaExportEntry, nowSeconds: number): number | undefined {
	if (entry.renderType !== "percent" || entry.resetAt === undefined) return undefined
	const length = windowLengthSeconds(entry)
	if (length === undefined) return undefined
	const timeRemainingShare = Math.min(1, Math.max(0, (entry.resetAt - nowSeconds) / length))
	return entry.percentRemaining! - timeRemainingShare * 100
}

/** A provider can only sustain the pace of its most constrained window. */
export function providerSpare(status: QuotaProviderStatus, nowSeconds: number): number | undefined {
	if (status.status === "unavailable" || status.status === "error") return undefined
	const spares = status.entries
		.map((entry) => entrySpare(entry, nowSeconds))
		.filter((spare): spare is number => spare !== undefined)
	return spares.length > 0 ? Math.min(...spares) : undefined
}

/**
 * Ranks providers by spare while preserving input order for ties and entries
 * without a usable window.
 */
export function sortProvidersBySpare<T extends { spare: number | undefined }>(providers: T[]): T[] {
	return providers
		.map((provider, index) => ({ provider, index }))
		.sort((a, b) => {
			if (a.provider.spare === undefined) return b.provider.spare === undefined ? a.index - b.index : 1
			if (b.provider.spare === undefined) return -1
			return b.provider.spare - a.provider.spare || a.index - b.index
		})
		.map(({ provider }) => provider)
}
