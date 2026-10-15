import type { ApiClient } from './client'
import type {
  Brand,
  Credentials,
  DeleteTokenResult,
  ImportInput,
  ImportResult,
  NameAndSlug,
  Organization,
  PutTokenInput,
  PutTokenResult,
  TokenList,
  User,
  ValidationReport,
} from './types'

/**
 * The typed calls the app makes (ADR 0013, 0014): method, path and body in one
 * place. Ids go into the path URL-encoded, and request bodies are rebuilt from
 * the named fields, so a stray property on a form value can never reach the API
 * (whose bodies are strict and would answer 400).
 */
export function createEndpoints(client: ApiClient) {
  const enc = encodeURIComponent
  const tokensBase = (organizationId: string, brandId: string) =>
    `/api/orgs/${enc(organizationId)}/brands/${enc(brandId)}/tokens`

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

    listTokens(
      organizationId: string,
      brandId: string,
      options?: { signal?: AbortSignal },
    ): Promise<TokenList> {
      return client.get<TokenList>(tokensBase(organizationId, brandId), options)
    },

    /** Create (no `expectedVersion`) or update (with it). The body is rebuilt from named fields. */
    putToken(
      organizationId: string,
      brandId: string,
      input: PutTokenInput,
    ): Promise<PutTokenResult> {
      return client.put<PutTokenResult>(
        `${tokensBase(organizationId, brandId)}/${enc(input.path)}`,
        {
          ...(input.type === undefined ? {} : { type: input.type }),
          value: input.value,
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.expectedVersion === undefined
            ? {}
            : { expectedVersion: input.expectedVersion }),
        },
      )
    },

    deleteToken(
      organizationId: string,
      brandId: string,
      path: string,
      expectedVersion: number,
    ): Promise<DeleteTokenResult> {
      return client.del<DeleteTokenResult>(
        `${tokensBase(organizationId, brandId)}/${enc(path)}?expectedVersion=${enc(String(expectedVersion))}`,
      )
    },

    validateDraft(
      organizationId: string,
      brandId: string,
      options?: { signal?: AbortSignal },
    ): Promise<ValidationReport> {
      return client.get<ValidationReport>(
        `/api/orgs/${enc(organizationId)}/brands/${enc(brandId)}/validate`,
        options,
      )
    },

    importTokens(
      organizationId: string,
      brandId: string,
      input: ImportInput,
    ): Promise<ImportResult> {
      return client.post<ImportResult>(
        `${tokensBase(organizationId, brandId)}/import`,
        { tree: input.tree, expectedRevision: input.expectedRevision },
      )
    },
  }
}

export type Endpoints = ReturnType<typeof createEndpoints>
