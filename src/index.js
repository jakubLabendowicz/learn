export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    if (pathname === "/courses" || pathname === "/courses/") {
      // Serve the course list page
      pathname = "/courses/index.html";
    } else if (pathname.startsWith("/courses/") && !pathname.endsWith(".html")) {
      // Serve /courses/<name> (no extension) by mapping it to /courses/<name>.html
      pathname = `${pathname}.html`;
    }

    if (pathname !== url.pathname) {
      const rewritten = new URL(request.url);
      rewritten.pathname = pathname;
      return env.ASSETS.fetch(new Request(rewritten, request));
    }

    return env.ASSETS.fetch(request);
  },
};
