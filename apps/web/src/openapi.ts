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
            description: "The latest run activity",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["activity"],
                  properties: {
                    activity: { type: "string", example: "Croft is reviewing …" },
                  },
                },
              },
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
