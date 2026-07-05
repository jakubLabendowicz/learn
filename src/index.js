function hasExtension(pathname) {
  const lastSegment = pathname.split("/").pop();
  return lastSegment.includes(".");
}

// Reserved top-level pages under /courses/ that are NOT course slugs.
// Their clean URL already matches their filename (e.g. generate.html ->
// /courses/generate), so leaving pathname untouched lets the assets
// binding resolve them directly.
const RESERVED_COURSE_PAGES = new Set(["generate", "import"]);

// The public marketing site lives on the apex/root host
// (learn.labendowicz.com); the actual web app lives on the "app."
// subdomain (app.learn.labendowicz.com). Locally (wrangler dev), the
// request's actual hostname is always localhost, so this is decided from
// the Host header instead of url.hostname — that also makes it testable
// locally via `curl -H "Host: app.learn.labendowicz.com" ...`.
const APP_HOST_PREFIX = "app.";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = (request.headers.get("host") || url.hostname).toLowerCase();
    const isApp = host.startsWith(APP_HOST_PREFIX);
    let pathname = url.pathname;

    if (!isApp) {
      // Marketing site: a single descriptive landing page, nothing else.
      // "/marketing/" (trailing slash, no .html) is the clean-URL form
      // the assets binding serves directly, without a redirect.
      if (pathname === "/" || pathname === "") {
        pathname = "/marketing/";
      }
      if (pathname !== url.pathname) {
        const rewritten = new URL(request.url);
        rewritten.pathname = pathname;
        return env.ASSETS.fetch(new Request(rewritten, request));
      }
      return env.ASSETS.fetch(request);
    }

    // ---- app.learn.labendowicz.com ----
    if (pathname === "/courses" || pathname === "/courses/") {
      // Course list page. "/courses/" (trailing slash, no .html) is the
      // clean-URL form the assets binding serves directly — rewriting to
      // ".../index.html" instead would redirect back to this same
      // pathname, looping forever now that the Worker runs on every
      // request (run_worker_first).
      pathname = "/courses/";
    } else if (pathname.startsWith("/courses/") && !hasExtension(pathname)) {
      const slug = pathname.replace(/^\/courses\//, "").replace(/\/$/, "");
      if (!RESERVED_COURSE_PAGES.has(slug)) {
        // /courses/<slug>[/...] (no extension) is rendered dynamically by
        // the client-side course engine, whatever the nested path depth
        // (modules, articles, quizes, question sets, questions, etc.).
        // Use the clean-URL form (no .html) so the assets binding serves
        // it without redirecting to the canonical URL of course.html itself.
        pathname = "/courses/course";
      }
    }
    // Note: /archive/<slug> (no extension) already resolves directly to
    // archive/<slug>.html via the assets binding's own clean-URL
    // resolution — no rewrite needed (appending ".html" here would just
    // trigger a redirect back to the extension-less form).

    if (pathname !== url.pathname) {
      const rewritten = new URL(request.url);
      rewritten.pathname = pathname;
      return env.ASSETS.fetch(new Request(rewritten, request));
    }

    return env.ASSETS.fetch(request);
  },
};
