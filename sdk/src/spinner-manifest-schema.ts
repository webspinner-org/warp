/**
 * JSON Schema (Draft 2020-12) for the SpinnerManifest type defined in
 * `./manifest.ts`. The single source of truth for "is this manifest
 * well-formed?" validation, used by:
 *
 *   - `lintSpinnerBundle` (sdk/src/lint.ts) to gate sign + install.
 *   - The Weaver at install time (forthcoming).
 *   - The `/admin/spinners/new` UI form (forthcoming) for live feedback.
 *
 * Hand-authored to mirror the TypeScript shape exactly. When the
 * TypeScript interface changes, update this schema in the same commit;
 * `lint.test.ts` has structural fixtures that catch drift between the
 * two.
 *
 * `$schema` points at Draft 2020-12 because that's what ajv supports
 * natively in its `2020` build. `$id` brands this schema as a Warp
 * primitive; consumers reference it by URN, not file path.
 */

export const spinnerManifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:webspinner:schema:spinner-manifest:v1.0.0',
  type: 'object',
  required: [
    'manifestVersion',
    'name',
    'displayName',
    'version',
    'description',
    'license',
    'entrypoint',
    'vault',
    'spools',
    'env',
    'dependsOn',
    'capabilities',
    'documentation',
    'thumbnail',
    'threadable',
    'audit',
  ],
  additionalProperties: false,
  properties: {
    manifestVersion: { const: '1.0' },
    name: {
      type: 'string',
      pattern: '^@[a-z0-9-]+/[a-z0-9-]+$',
      maxLength: 128,
    },
    displayName: { type: 'string', minLength: 1, maxLength: 64 },
    version: {
      type: 'string',
      pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$',
      maxLength: 64,
    },
    description: { type: 'string', minLength: 1, maxLength: 2048 },
    homepage: { type: 'string', pattern: '^https?://[^\\s]+$', maxLength: 512 },
    license: { type: 'string', minLength: 1, maxLength: 64 },
    entrypoint: { type: 'string', minLength: 1, maxLength: 256 },
    model: { type: 'string', maxLength: 128 },
    vault: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'uri', 'required'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 128 },
          uri: { type: 'string', minLength: 1, maxLength: 512 },
          required: { type: 'boolean' },
        },
      },
    },
    spools: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'spool', 'required'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 128 },
          spool: { type: 'string', minLength: 1, maxLength: 256 },
          required: { type: 'boolean' },
        },
      },
    },
    env: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'required', 'description'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 128 },
          required: { type: 'boolean' },
          default: { type: 'string' },
          description: { type: 'string', minLength: 1, maxLength: 512 },
        },
      },
    },
    dependsOn: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'versionRange'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^@[a-z0-9-]+/[a-z0-9-]+$' },
          versionRange: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
    },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'displayName', 'description'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^[a-z][a-zA-Z0-9]*$', maxLength: 64 },
          displayName: { type: 'string', minLength: 1, maxLength: 64 },
          description: { type: 'string', minLength: 1, maxLength: 1024 },
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          emitsAudit: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
    shellAllowlist: {
      type: 'array',
      items: { type: 'string', pattern: '^[a-zA-Z0-9_-]+$', maxLength: 64 },
    },
    outboundAllowlist: {
      type: 'array',
      // DNS hostname per RFC 1035 §2.3.4 + RFC 1123: lowercase labels of
      // alphanumerics + hyphens (no leading / trailing hyphen), separated by
      // dots, at least two labels (rules out bare `localhost`). No schemes,
      // paths, ports, or wildcards in v0.
      items: {
        type: 'string',
        pattern: '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$',
        maxLength: 253,
      },
    },
    documentation: {
      type: 'object',
      required: ['howItWorks'],
      additionalProperties: false,
      properties: {
        howItWorks: { type: 'string', minLength: 1, maxLength: 256 },
        readme: { type: 'string', minLength: 1, maxLength: 256 },
        examples: { type: 'string', minLength: 1, maxLength: 256 },
        additional: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'path'],
            additionalProperties: false,
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 128 },
              path: { type: 'string', minLength: 1, maxLength: 256 },
            },
          },
        },
      },
    },
    thumbnail: { type: 'string', minLength: 1, maxLength: 256 },
    threadable: { type: 'boolean' },
    audit: {
      type: 'object',
      required: ['source'],
      additionalProperties: false,
      properties: {
        source: { type: 'string', minLength: 1, maxLength: 256 },
      },
    },
  },
} as const;
