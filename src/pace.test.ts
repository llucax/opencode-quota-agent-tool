import assert from "node:assert/strict"
import test from "node:test"
import { entrySpare, providerSpare, sortProvidersBySpare, windowLengthSeconds } from "./pace.ts"
import type { QuotaExportEntry } from "./quota-export.ts"

const HOUR = 60 * 60
const DAY = 24 * HOUR

function percentEntry(overrides: Partial<QuotaExportEntry> = {}): QuotaExportEntry {
	return {
		name: "Quota",
		window: "5h",
		resetAt: 10 * HOUR,
		renderType: "percent",
		percentRemaining: 50,
		...overrides,
	}
}

test("derives fixed 5h and Weekly window lengths", () => {
	assert.equal(windowLengthSeconds(percentEntry()), 5 * HOUR)
	assert.equal(windowLengthSeconds(percentEntry({ window: "Weekly" })), 7 * DAY)
})

test("derives a null Copilot window from the preceding calendar month", () => {
	const octoberReset = Date.UTC(2026, 9, 1) / 1000
	const marchReset = Date.UTC(2028, 2, 1) / 1000

	assert.equal(windowLengthSeconds(percentEntry({ window: undefined, resetAt: octoberReset })), 30 * DAY)
	assert.equal(windowLengthSeconds(percentEntry({ window: undefined, resetAt: marchReset })), 29 * DAY)
	const spare = entrySpare(percentEntry({ window: undefined, resetAt: octoberReset, percentRemaining: 48 }), octoberReset - 10 * DAY)
	assert.ok(spare !== undefined && Math.abs(spare - (48 - 100 / 3)) < Number.EPSILON * 100)
})

test("a reset in the past has no remaining time reservation", () => {
	assert.equal(entrySpare(percentEntry({ resetAt: 100, percentRemaining: 42 }), 101), 42)
})

test("value entries have no spare", () => {
	assert.equal(
		entrySpare({ name: "Spend", window: "Monthly", resetAt: 100, renderType: "value", value: "$12.50" }, 50),
		undefined,
	)
})

test("a provider uses its lowest usable window spare", () => {
	const status = {
		status: "ok" as const,
		fetchedAt: 0,
		entries: [
			percentEntry({ resetAt: 4 * HOUR, percentRemaining: 90 }),
			percentEntry({ resetAt: 2 * HOUR, percentRemaining: 20 }),
		],
	}
	assert.equal(providerSpare(status, 0), -20)
})

test("a provider with only an error has no spare", () => {
	assert.equal(providerSpare({ status: "error", fetchedAt: 0, error: "unavailable" }, 0), undefined)
})

test("sorts descending, keeps no-spare providers last, and preserves ties", () => {
	const providers = [
		{ id: "none-a", spare: undefined },
		{ id: "low", spare: -20 },
		{ id: "high-a", spare: 10 },
		{ id: "high-b", spare: 10 },
		{ id: "none-b", spare: undefined },
	]

	assert.deepEqual(
		sortProvidersBySpare(providers).map(({ id }) => id),
		["high-a", "high-b", "low", "none-a", "none-b"],
	)
})
