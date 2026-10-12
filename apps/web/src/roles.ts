import type { Role, Visibility } from './api/types'

export function roleLabel(role: Role): string {
  return { OWNER: 'Owner', EDITOR: 'Editor', VIEWER: 'Viewer' }[role]
}

export function visibilityLabel(visibility: Visibility): string {
  return { PRIVATE: 'Private', PUBLIC: 'Public' }[visibility]
}

/** Who may create brands (the API repeats this check: EDITOR or higher). */
export function canCreateBrands(role: Role): boolean {
  return role === 'OWNER' || role === 'EDITOR'
}
