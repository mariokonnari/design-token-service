import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

/** WCAG 2.0 A/AA, 2.1 AA and 2.2 AA rules. color-contrast is part of wcag2aa. */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

export type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>

export function runAxe(page: Page): Promise<AxeResults> {
  return new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()
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
