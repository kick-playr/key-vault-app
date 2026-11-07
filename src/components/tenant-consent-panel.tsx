"use client";
import React from "react";
export function TenantConsentPanel({
  enabled,
  canManage,
  onChange,
  busy = false,
}: {
  enabled: boolean;
  canManage: boolean;
  onChange: (enabled: boolean) => Promise<void>;
  busy?: boolean;
}) {
  return (
    <section className="panel">
      <h3>Global administrator access</h3>
      <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={!canManage || busy}
          onChange={(event) => void onChange(event.target.checked)}
        />
        Allow global admins to view and edit this tenant’s secrets
      </label>
      <p>
        {canManage
          ? "Approval remains active until you revoke it."
          : "Only this tenant’s club administrator can change this approval."}
      </p>
    </section>
  );
}
