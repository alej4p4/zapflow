/**
 * Auth Fetch Shield
 * Intercepts client-side fetch calls to /api/auth/* to guarantee that
 * non-JSON responses (HTML 502/520/521/524/530 from Cloudflare, server reboot, or proxy)
 * never crash NextAuth's `fetchData` with `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 */

if (typeof window !== "undefined" && !(window as any).__zapflow_auth_shield_installed) {
  (window as any).__zapflow_auth_shield_installed = true;

  const originalFetch = window.fetch;

  window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
    const resource = args[0];
    let url = "";

    if (typeof resource === "string") {
      url = resource;
    } else if (resource instanceof URL) {
      url = resource.toString();
    } else if (resource && typeof resource === "object" && "url" in resource) {
      url = (resource as Request).url;
    }

    const isAuthRequest = url.includes("/api/auth/");

    if (!isAuthRequest) {
      return originalFetch.apply(this, args);
    }

    try {
      const response = await originalFetch.apply(this, args);

      // Check if response might be an HTML error page or broken response
      const contentType = response.headers.get("content-type") || "";
      const isHtml = contentType.toLowerCase().includes("text/html");
      const isServerError = response.status >= 500;

      if (isHtml || isServerError) {
        // Safe fallback for /api/auth/session: NextAuth expects JSON `null` when unauthenticated
        if (url.includes("/api/auth/session")) {
          return new Response(JSON.stringify(null), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }

        // Safe fallback for other auth endpoints (csrf, providers, etc.): empty JSON object
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      // Clone response to verify it's valid JSON before handing it over to NextAuth
      // This protects against 200 OK responses with HTML bodies (e.g. captive portals, login redirects)
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        const trimmed = text.trim();
        if (trimmed.startsWith("<") || trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
          if (url.includes("/api/auth/session")) {
            return new Response(JSON.stringify(null), {
              status: 200,
              headers: { "Content-Type": "application/json; charset=utf-8" },
            });
          }
          return new Response(JSON.stringify({}), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          });
        }
      } catch {
        // If cloning or reading fails, continue with original response
      }

      return response;
    } catch {
      // Network drop, tunnel offline, or connection refused
      if (url.includes("/api/auth/session")) {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
  };

  // Shield console.error from Auth.js harmless ClientFetchError noise
  const originalConsoleError = console.error;
  console.error = function (...args: any[]) {
    const firstArg = args[0];
    const message =
      typeof firstArg === "string"
        ? firstArg
        : firstArg && typeof firstArg === "object" && "message" in firstArg
        ? (firstArg as any).message
        : "";

    if (
      typeof message === "string" &&
      (message.includes("is not valid JSON") ||
        message.includes("ClientFetchError") ||
        message.includes("Unexpected token '<'") ||
        message.includes("errors.authjs.dev"))
    ) {
      console.debug("[AuthShield] Silenced auth JSON parsing blip:", message);
      return;
    }

    originalConsoleError.apply(console, args);
  };
}

export {};
