export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Croft API",
    version: "1.0.0",
    description: "Read Croft's current activity.",
  },
  paths: {
    "/api/v1/activity": {
      get: {
        summary: "Get latest activity",
        operationId: "getLatestActivity",
        security: [{ ApiKeyAuth: [] }],
        responses: {
          "200": {
            description: "The latest run with activity",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Run" } },
            },
          },
          "401": {
            description: "Missing or invalid API key",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "404": {
            description: "No runs found",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "500": {
            description: "API key is not configured",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
    schemas: {
      Run: {
        type: "object",
        required: [
          "id",
          "repo",
          "prNumber",
          "mode",
          "freshPlan",
          "status",
          "previewUrl",
          "jobRunId",
          "providerId",
          "model",
          "credentialId",
          "report",
          "error",
          "flavourText",
          "createdAt",
          "startedAt",
          "finishedAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          repo: { type: "string", example: "owner/repo" },
          prNumber: { type: "integer" },
          mode: { type: "string", enum: ["test", "review"] },
          freshPlan: { type: "boolean" },
          status: {
            type: "string",
            enum: ["queued", "starting", "running", "passed", "failed", "partial", "cap_hit", "canceled", "error"],
          },
          previewUrl: { type: ["string", "null"], format: "uri" },
          jobRunId: { type: ["string", "null"] },
          providerId: { type: "string" },
          model: { type: "string" },
          credentialId: { type: "string", format: "uuid" },
          report: { type: ["object", "null"] },
          error: { type: ["string", "null"] },
          flavourText: { type: ["string", "null"], example: "I'm inspecting this PR, since apparently someone has to." },
          createdAt: { type: "string", format: "date-time" },
          startedAt: { type: ["string", "null"], format: "date-time" },
          finishedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
        },
      },
    },
  },
};
