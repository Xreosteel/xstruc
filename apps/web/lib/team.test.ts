import { describe, expect, it } from "vitest";
import { findUserIdByEmail, isRole } from "@/lib/team";

const fake = (emails: string[]) => ({
  calls: 0,
  async listUsers({ page, perPage }: { page: number; perPage: number }) {
    this.calls++;
    const users = emails.map((e, i) => ({ id: "u" + i, email: e })).slice((page - 1) * perPage, page * perPage);
    return { data: { users }, error: null };
  }
});

describe("team helpers", () => {
  it("finds a user by email, ignoring case and spaces, across pages", async () => {
    const admin = fake(Array.from({ length: 450 }, (_, i) => "p" + i + "@xreo.com.au"));
    expect(await findUserIdByEmail(admin, "  P420@XREO.com.au ", 200)).toBe("u420");
    expect(admin.calls).toBe(3);
  });
  it("returns null when nobody signed in with that email", async () => {
    expect(await findUserIdByEmail(fake(["a@x.com"]), "b@x.com")).toBeNull();
  });
  it("knows the roles", () => {
    expect(isRole("approver")).toBe(true);
    expect(isRole("superuser")).toBe(false);
  });
});
