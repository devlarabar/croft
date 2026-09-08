export function GET() {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="SwaggerUI" />
    <title>Croft API docs</title>
  </head>
  <body>
    <div>
      <div id="swagger-ui"></div>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.14/swagger-ui.css" />
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.14/swagger-ui-bundle.js" crossorigin="anonymous"></script>
      <script>
        window.onload = () => {
          window.ui = SwaggerUIBundle({ dom_id: '#swagger-ui', url: '/api/openapi.json' });
        };
      </script>
    </div>
  </body>
</html>`, { headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
