export type RequestHandler<Context = unknown> = (request: Request, context: Context) => Response | Promise<Response>;

export function redirect(location: string): Response {
  const encoded = /[^\x00-\xFF]/.test(location) ? encodeURI(location) : location;
  return new Response(null, { status: 302, headers: { location: encoded } });
}

export function serverError(error: unknown): Response {
  console.error(error);
  return new Response("Something went wrong. Please try again.", { status: 500 });
}

export function route<Context>(handler: RequestHandler<Context>): RequestHandler<Context> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return serverError(error);
    }
  };
}
