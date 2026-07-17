// Supabase Auth helper — dependency-free. Verifies the access token the browser gets from
// Supabase Auth (sign-in with Google or email/password) by asking GoTrue who it belongs to.
// We don't hand-verify the JWT signature: GoTrue is the source of truth, and this is one
// cheap call that also rejects revoked/expired tokens for free.
//
// The anon key identifies the project on the /auth/v1/user call; it's safe server-side.
// Falls back to the service-role key if SUPABASE_ANON_KEY isn't set.

function projectKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// Pulls the "Bearer <token>" value off the request, or null.
export function bearerFromReq(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  const token = String(h).replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

// Permanently deletes a Supabase Auth user (admin API, service-role only). Used when an owner
// deletes their own account — call only after verifying the caller IS that user.
export async function deleteAuthUser(userId) {
  if (!userId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, error: "Not configured" };
  }
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) {
      console.error("deleteAuthUser error:", res.status, await res.text());
      return { ok: false, error: "Failed to delete account" };
    }
    return { ok: true };
  } catch (e) {
    console.error("deleteAuthUser error:", e);
    return { ok: false, error: "Failed to delete account" };
  }
}

// Resolves a token to its Supabase user ({ id, email, ... }) or null if invalid/expired.
export async function getUserFromToken(token) {
  if (!token || !process.env.SUPABASE_URL) return null;
  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: projectKey(), Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user : null;
  } catch (e) {
    console.error("getUserFromToken error:", e);
    return null;
  }
}
