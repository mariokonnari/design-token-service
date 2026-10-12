import type { ApiClient } from './client'
import type {
  Brand,
  Credentials,
  NameAndSlug,
  Organization,
  User,
} from './types'

/**
 * The typed calls the app makes (ADR 0013, 0014): method, path and body in one
 * place. Ids go into the path URL-encoded, and request bodies are rebuilt from
 * the named fields, so a stray property on a form value can never reach the API
 * (whose bodies are strict and would answer 400).
 */
export function createEndpoints(client: ApiClient) {
  const enc = encodeURIComponent

  return {
    async signup(input: Credentials): Promise<User> {
      const reply = await client.post<{ user: User }>('/api/auth/signup', {
        email: input.email,
        password: input.password,
      })
      return reply.user
    },

    async login(input: Credentials): Promise<User> {
      const reply = await client.post<{ user: User }>('/api/auth/login', {
        email: input.email,
        password: input.password,
      })
      return reply.user
    },

    async logout(): Promise<void> {
      await client.post<void>('/api/auth/logout')
    },

    async me(options?: { signal?: AbortSignal }): Promise<User> {
      const reply = await client.get<{ user: User }>('/api/me', options)
      return reply.user
    },

    async listOrganizations(options?: {
      signal?: AbortSignal
    }): Promise<Organization[]> {
      const reply = await client.get<{ organizations: Organization[] }>(
        '/api/orgs',
        options,
      )
      return reply.organizations
    },

    async createOrganization(input: NameAndSlug): Promise<Organization> {
      const reply = await client.post<{ organization: Organization }>(
        '/api/orgs',
        { name: input.name, slug: input.slug },
      )
      return reply.organization
    },

    async listBrands(
      organizationId: string,
      options?: { signal?: AbortSignal },
    ): Promise<Brand[]> {
      const reply = await client.get<{ brands: Brand[] }>(
        `/api/orgs/${enc(organizationId)}/brands`,
        options,
      )
      return reply.brands
    },

    async getBrand(
      organizationId: string,
      brandId: string,
      options?: { signal?: AbortSignal },
    ): Promise<Brand> {
      const reply = await client.get<{ brand: Brand }>(
        `/api/orgs/${enc(organizationId)}/brands/${enc(brandId)}`,
        options,
      )
      return reply.brand
    },

    async createBrand(
      organizationId: string,
      input: NameAndSlug,
    ): Promise<Brand> {
      const reply = await client.post<{ brand: Brand }>(
        `/api/orgs/${enc(organizationId)}/brands`,
        { name: input.name, slug: input.slug },
      )
      return reply.brand
    },
  }
}

export type Endpoints = ReturnType<typeof createEndpoints>
