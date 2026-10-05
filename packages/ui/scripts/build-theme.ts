import { writeFileSync } from 'node:fs'
import {
  GENERATED_CSS_PATH,
  ThemeBuildError,
  buildThemes,
  formatIssue,
  loadThemeSources,
  renderThemesCss,
} from './lib/buildThemes'

// Run with `pnpm generate:theme`. Fails (exit code 1) with a readable list on
// any error-severity issue; warnings are printed and do not fail the build.
try {
  const builds = buildThemes(loadThemeSources())
  for (const build of builds) {
    for (const issue of build.issues) {
      console.warn(`warning: ${formatIssue(build.slug, issue)}`)
    }
  }
  writeFileSync(GENERATED_CSS_PATH, renderThemesCss(builds))
  console.log(
    `generated ${GENERATED_CSS_PATH} (${builds.map((build) => build.slug).join(', ')})`,
  )
} catch (error) {
  if (error instanceof ThemeBuildError) {
    console.error(error.message)
    process.exitCode = 1
  } else {
    throw error
  }
}
