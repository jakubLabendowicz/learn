export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve /courses/<name> (no extension) by mapping it to /courses/<name>.html
    if (url.pathname.startsWith("/courses/") && !url.pathname.endsWith(".html")) {
      const rewritten = new URL(request.url);
      rewritten.pathname = `${url.pathname}.html`;
      return env.ASSETS.fetch(new Request(rewritten, request));
    }

    return env.ASSETS.fetch(request);
  },
};
