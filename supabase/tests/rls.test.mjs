// Row-level security and data rules of the foundation migration (architecture v2 §7), run in PGlite: real Postgres
// in WebAssembly, no Docker. Each role at XREO does exactly what the architecture says, and nothing reaches across
// to another organisation. tests/supabase-stub.sql stands in for the parts of Supabase the migration relies on.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";

// XSTRUC_MIGRATIONS=<dir> runs the tests against a changed copy (mutation checks: a broken rule must fail a test)
const dir = process.env.XSTRUC_MIGRATIONS ? pathToFileURL(process.env.XSTRUC_MIGRATIONS.replace(/\/?$/, "/")) : new URL("../migrations/", import.meta.url);
const U = {
  owner: "00000000-0000-4000-8000-000000000001",
  admin: "00000000-0000-4000-8000-000000000002",
  approver: "00000000-0000-4000-8000-000000000003",
  detailer: "00000000-0000-4000-8000-000000000004",
  site: "00000000-0000-4000-8000-000000000005",
  viewer: "00000000-0000-4000-8000-000000000006",
  other: "00000000-0000-4000-8000-000000000007",
  newcomer: "00000000-0000-4000-8000-000000000008"
};
const HASH = "a".repeat(64), HASH2 = "b".repeat(64);
let db, XREO, OTHER, otherProject;

// run fn as a signed-in user (or as the server's service role, still naming the user for the audit log)
async function as(who, fn, role = "authenticated") {
  const uid = who ? U[who] : "";
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role ${who ? role : "anon"};`);
  try { return await fn(); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);"); }
}
const server = (who, fn) => as(who, fn, "service_role");
const q = (sql, params) => db.query(sql, params);
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const refused = async (p, re) => { await assert.rejects(p, re); };

before(async () => {
  db = await PGlite.create();
  await db.exec(readFileSync(new URL("./supabase-stub.sql", import.meta.url), "utf8"));
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) await db.exec(readFileSync(new URL(f, dir), "utf8"));
  await db.exec("grant all on all tables in schema public to service_role;");
  for (const [k, id] of Object.entries(U)) await q("insert into auth.users (id, email) values ($1, $2)", [id, k + "@example.com"]);
  XREO = await as("owner", async () => (await rows("select public.create_organisation('XREO', 'xreo') as id"))[0].id);
  OTHER = await as("other", async () => (await rows("select public.create_organisation('Other Co', 'other-co') as id"))[0].id);
  otherProject = await as("other", async () => (await rows("insert into public.projects (org_id, name) values ($1, 'Their job') returning id", [OTHER]))[0].id);
});

test("create_organisation makes the caller its owner; a signed-out visitor cannot", async () => {
  const m = await as("owner", () => rows("select role from public.members where org_id = $1 and user_id = $2", [XREO, U.owner]));
  assert.deepEqual(m, [{ role: "owner" }]);
  await refused(as(null, () => q("select public.create_organisation('Nope')")), /permission denied|sign in/);
  await refused(as("newcomer", () => q("insert into public.organisations (name) values ('Direct')")), /permission denied/);
});

test("owners and admins manage members; an admin cannot make an owner; a detailer cannot add anyone", async () => {
  await as("owner", async () => {
    for (const r of ["admin", "approver", "detailer", "site", "viewer"]) {
      await q("insert into public.members (org_id, user_id, role) values ($1, $2, $3)", [XREO, U[r], r]);
    }
  });
  await refused(as("admin", () => q("insert into public.members (org_id, user_id, role) values ($1, $2, 'owner')", [XREO, U.newcomer])), /row-level security/);
  await refused(as("detailer", () => q("insert into public.members (org_id, user_id, role) values ($1, $2, 'viewer')", [XREO, U.newcomer])), /row-level security/);
  const n = await as("viewer", () => rows("select count(*)::int as n from public.members where org_id = $1", [XREO]));
  assert.equal(n[0].n, 6, "members see everyone in their organisation");
});

test("organisations are kept apart", async () => {
  await as("detailer", async () => {
    assert.deepEqual((await rows("select name from public.organisations")).map(r => r.name), ["XREO"]);
    assert.equal((await rows("select * from public.projects where org_id = $1", [OTHER])).length, 0);
    assert.equal((await rows("select * from public.members where org_id = $1", [OTHER])).length, 0);
    await refused(q("insert into public.projects (org_id, name) values ($1, 'Sneaky')", [OTHER]), /row-level security/);
  });
  await as("other", async () => {
    assert.deepEqual((await rows("select name from public.projects")).map(r => r.name), ["Their job"]);
  });
});

let project, element;
test("detailers create projects and elements; site and viewer cannot; only admins delete", async () => {
  project = await as("detailer", async () => (await rows("insert into public.projects (org_id, name, job_number) values ($1, 'Salisbury warehouse slab', 'J-1001') returning id, created_by", [XREO]))[0]);
  assert.equal(project.created_by, U.detailer, "created_by comes from the session, not the client");
  element = await as("detailer", async () => (await rows("insert into public.elements (org_id, project_id, kind, name) values ($1, $2, 'floor', 'Level 1 floor') returning id", [XREO, project.id]))[0].id);
  for (const who of ["site", "viewer"]) {
    await refused(as(who, () => q("insert into public.projects (org_id, name) values ($1, 'No')", [XREO])), /row-level security/);
  }
  const del = await as("detailer", () => q("delete from public.projects where id = $1", [project.id]));
  assert.equal(del.affectedRows, 0, "a detailer cannot delete a project");
  const p2 = await as("detailer", async () => (await rows("insert into public.projects (org_id, name) values ($1, 'Scratch') returning id", [XREO]))[0].id);
  const del2 = await as("admin", () => q("delete from public.projects where id = $1", [p2]));
  assert.equal(del2.affectedRows, 1, "an admin can");
});

test("an element cannot point at another organisation's project", async () => {
  await refused(as("detailer", () => q("insert into public.elements (org_id, project_id, kind, name) values ($1, $2, 'panel', 'P1')", [XREO, otherProject])), /foreign key|violates/);
});

let v1, v2;
test("versions are numbered by the database and saved as drafts only", async () => {
  await as("detailer", async () => {
    v1 = (await rows("insert into public.model_versions (org_id, element_id, number, inputs, engine_version, output_hash) values ($1, $2, 99, '{\"thickness\":200}', '1.0.0', $3) returning id, number, status", [XREO, element, HASH]))[0];
    v2 = (await rows("insert into public.model_versions (org_id, element_id, number, inputs, engine_version, output_hash) values ($1, $2, 99, '{\"thickness\":250}', '1.0.0', $3) returning id, number", [XREO, element, HASH2]))[0];
    await refused(q("insert into public.model_versions (org_id, element_id, inputs, engine_version, output_hash, status) values ($1, $2, '{}', '1.0.0', $3, 'approved')", [XREO, element, HASH]), /row-level security/);
    await refused(q("insert into public.model_versions (org_id, element_id, inputs, engine_version, output_hash) values ($1, $2, '{}', '1.0', 'nothex')", [XREO, element]), /check constraint/);
  });
  assert.deepEqual([v1.number, v1.status, v2.number], [1, "draft", 2]);
  const seen = await as("site", () => rows("select id from public.model_versions"));
  assert.equal(seen.length, 0, "site crews do not see drafts");
});

test("only the server approves, only with a matching approval, and approved means frozen", async () => {
  await refused(as("approver", () => q("insert into public.approvals (org_id, version_id, approved_by, engine_version, output_hash) values ($1, $2, $3, '1.0.0', $4)", [XREO, v1.id, U.approver, HASH])), /permission denied/);
  await refused(server("approver", () => q("update public.model_versions set status = 'approved' where id = $1", [v1.id])), /no matching approval/);
  await refused(server("approver", async () => {
    await q("insert into public.approvals (org_id, version_id, approved_by, engine_version, output_hash) values ($1, $2, $3, '1.0.0', $4)", [XREO, v2.id, U.approver, HASH]);
    await q("update public.model_versions set status = 'approved' where id = $1", [v2.id]);   // v2's hash is HASH2
  }), /no matching approval/);
  await server("approver", async () => {
    await q("delete from public.approvals where version_id = $1", [v2.id]);
    await q("insert into public.approvals (org_id, version_id, approved_by, engine_version, output_hash) values ($1, $2, $3, '1.0.0', $4)", [XREO, v1.id, U.approver, HASH]);
    await q("update public.model_versions set status = 'approved' where id = $1", [v1.id]);
  });
  const upd = await as("detailer", () => q("update public.model_versions set inputs = '{\"thickness\":300}' where id = $1", [v1.id]));
  assert.equal(upd.affectedRows, 0, "a detailer cannot touch an approved version");
  await refused(server("approver", () => q("update public.model_versions set inputs = '{\"thickness\":300}' where id = $1", [v1.id])), /frozen/);
  await refused(server("approver", () => q("update public.model_versions set output_hash = $2 where id = $1", [v1.id, HASH2])), /frozen/);
  await server("approver", () => q("update public.model_versions set status = 'issued' where id = $1", [v1.id]));
  const seen = await as("site", () => rows("select number, status from public.model_versions"));
  assert.deepEqual(seen, [{ number: 1, status: "issued" }], "site crews see the issued version");
  const del = await as("detailer", () => q("delete from public.model_versions where id = $1", [v1.id]));
  assert.equal(del.affectedRows, 0, "an issued version cannot be deleted");
});

test("the audit log records who did what; only owners and admins read it", async () => {
  const det = await as("detailer", () => rows("select * from public.audit_log"));
  assert.equal(det.length, 0);
  const log = await as("owner", () => rows("select actor, action, entity, detail from public.audit_log where org_id = $1 order by id", [XREO]));
  assert.ok(log.some(r => r.entity === "projects" && r.action === "INSERT" && r.actor === U.detailer));
  assert.ok(log.some(r => r.entity === "approvals" && r.action === "INSERT" && r.actor === U.approver));
  assert.ok(log.some(r => r.entity === "model_versions" && r.action === "UPDATE" && r.detail.status === "issued"));
  assert.ok(log.some(r => r.entity === "members" && r.detail.role === "site"));
  const other = await as("other", () => rows("select * from public.audit_log where org_id = $1", [XREO]));
  assert.equal(other.length, 0);
  await refused(as("owner", () => q("delete from public.audit_log")), /permission denied/);
});

test("files: one folder per organisation, same rules as the tables", async () => {
  await as("detailer", () => q("insert into storage.objects (bucket_id, name) values ('org-files', $1)", [XREO + "/drawings/S-101.pdf"]));
  await refused(as("detailer", () => q("insert into storage.objects (bucket_id, name) values ('org-files', $1)", [OTHER + "/drawings/x.pdf"])), /row-level security/);
  await refused(as("detailer", () => q("insert into storage.objects (bucket_id, name) values ('org-files', 'not-an-org/x.pdf')")), /row-level security/);
  await refused(as("site", () => q("insert into storage.objects (bucket_id, name) values ('org-files', $1)", [XREO + "/x.pdf"])), /row-level security/);
  assert.equal((await as("site", () => rows("select name from storage.objects"))).length, 1, "site crews can open their organisation's files");
  assert.equal((await as("other", () => rows("select name from storage.objects"))).length, 0, "another organisation sees none");
});

test("signed-out visitors get nothing", async () => {
  await refused(as(null, () => q("select * from public.projects")), /permission denied/);
  await refused(as(null, () => q("select * from public.model_versions")), /permission denied/);
});
