import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

/** WCAG 2.0 A/AA, 2.1 AA and 2.2 AA rules. color-contrast is part of wcag2aa. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>

/**
 * `include` limits the run to one subtree. Used ONLY while a modal <dialog> is open:
 * the page behind it is inert, and axe cannot decide the contrast of text that the
 * dialog's backdrop overlays ("incomplete"), so the dialog itself is what is checked.
 */
export function runAxe(page: Page, include?: string): Promise<AxeResults> {
  const builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  return (include === undefined ? builder : builder.include(include)).analyze()
}

/** Readable failure text: rule, impact, and every offending selector with its HTML. */
export function describeViolations(results: AxeResults): string {
  if (results.violations.length === 0) return 'no violations'
  return results.violations
    .map((v) => {
      const nodes = v.nodes
        .map(
          (n) =>
            `    selector: ${n.target.join(' ')}\n    html: ${n.html}\n    why: ${n.any[0]?.message ?? n.all[0]?.message ?? n.none[0]?.message ?? ''}`,
        )
        .join('\n')
      return `  [${v.id}] impact=${v.impact ?? 'n/a'}: ${v.help}\n${nodes}`
    })
    .join('\n')
}

/** How many nodes axe really evaluated for a rule (a pass or violation, not "incomplete"). */
export function evaluatedNodes(results: AxeResults, ruleId: string): number {
  const count = (items: AxeResults['passes']) =>
    items.find((r) => r.id === ruleId)?.nodes.length ?? 0
  return count(results.passes) + count(results.violations)
}

export function incompleteNodes(results: AxeResults, ruleId: string): number {
  return results.incomplete.find((r) => r.id === ruleId)?.nodes.length ?? 0
}

/**
 * The page has no WCAG violation, axe could decide every contrast check, and contrast
 * was really measured (a page with no text would pass vacuously).
 */
export async function expectNoViolations(
  page: Page,
  what: string,
  include?: string,
): Promise<void> {
  const results = await runAxe(page, include)
  expect(
    results.violations.length,
    `${what}
${describeViolations(results)}`,
  ).toBe(0)
  // "incomplete" means axe could not decide: a contrast failure could hide there
  expect(
    incompleteNodes(results, 'color-contrast'),
    `${what}: axe could not decide color-contrast for some nodes`,
  ).toBe(0)
  // not vacuous: contrast was really measured on this page
  expect(
    evaluatedNodes(results, 'color-contrast'),
    `${what}: no text was evaluated`,
  ).toBeGreaterThan(0)
}
