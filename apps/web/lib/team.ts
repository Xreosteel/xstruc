// Team helpers. Members are added by the email they signed in with: the service role can look a user up by email
// (the browser cannot), but the membership row itself is always written as the signed-in owner or admin, so the
// database's row-level security decides who may add whom.
export const ROLES = ["owner", "admin", "approver", "detailer", "site", "viewer"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_TEXT: Record<Role, string> = {
  owner: "Owner: everything, including members",
  admin: "Admin: members and settings, plus approving",
  approver: "Approver: approve models and issue them to site",
  detailer: "Detailer: create and edit projects and drafts",
  site: "Site: open issued models, offline included",
  viewer: "Viewer: read only"
};
export const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r);

interface AdminUsers {
  listUsers(p: { page: number; perPage: number }): Promise<{ data: { users: { id: string; email?: string | null }[] }; error: unknown }>;
}

/** The id of the user who signed in with this email, or null. Pages through the project's users (fine for a team). */
export async function findUserIdByEmail(admin: AdminUsers, email: string, perPage = 200, maxPages = 25): Promise<string | null> {
  const want = email.trim().toLowerCase();
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.listUsers({ page, perPage });
    if (error) throw error;
    const hit = data.users.find(u => (u.email || "").toLowerCase() === want);
    if (hit) return hit.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}
