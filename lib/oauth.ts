// Shared OAuth constants. Kept out of the route files because Next.js route
// modules may only export request handlers (GET/POST/…) — any other export
// fails the typed-routes build check.

/** Short-lived httpOnly cookie holding the CSRF state for the Google flow. */
export const OAUTH_STATE_COOKIE = "liberde_oauth_state";
