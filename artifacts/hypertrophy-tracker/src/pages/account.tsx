import { UserProfile } from "@clerk/react";
import { Link } from "wouter";
import { basePath } from "@/lib/clerk";

export default function AccountPage() {
  return (
    <main className="page-wrap enter" data-testid="page-account-security">
      <Link href="/profiles" className="btn btn-ghost" style={{ padding: 0, textDecoration: "none" }}>
        ← Profile settings
      </Link>
      <div className="eyebrow" style={{ marginTop: 12 }}>Account and security</div>
      <h1 className="display" style={{ fontSize: 42, margin: "8px 0 18px" }}>Account.</h1>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <UserProfile routing="path" path={`${basePath}/account`} />
      </div>
    </main>
  );
}