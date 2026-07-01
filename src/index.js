function hasExtension(pathname) {
  const lastSegment = pathname.split("/").pop();
  return lastSegment.includes(".");
}

// Reserved top-level pages under /courses/ that are NOT course slugs.
// Their clean URL already matches their filename (e.g. generate.html ->
// /courses/generate), so leaving pathname untouched lets the assets
// binding resolve them directly.
const RESERVED_COURSE_PAGES = new Set(["generate", "import"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let pathname = url.pathname;

    if (pathname === "/courses" || pathname === "/courses/") {
      // Course list page
      pathname = "/courses/index.html";
    } else if (pathname.startsWith("/courses/") && !hasExtension(pathname)) {
      const slug = pathname.replace(/^\/courses\//, "").replace(/\/$/, "");
      if (!RESERVED_COURSE_PAGES.has(slug)) {
        // /courses/<slug> (no extension) is rendered dynamically from <slug>.json.
        // Use the clean-URL form (no .html) so the assets binding serves it
        // without redirecting to the canonical URL of course.html itself.
        pathname = "/courses/course";
      }
    } else if (pathname.startsWith("/archive/") && !hasExtension(pathname)) {
      // /archive/<slug> serves the original static course page
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
