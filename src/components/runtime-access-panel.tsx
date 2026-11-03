"use client";
import React, { useEffect, useRef, useState } from "react";
import type { RuntimeConfigurationDocument } from "../lib/runtime-configuration";
type Access = {
  application: string;
  tenant: string;
  identityConfigured: boolean;
  authorized: boolean;
  oauthAuthorized?: boolean;
};
function parseAccess(
  input: unknown,
  application: string,
  tenant: string,
): Access {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid runtime access response.");
  const a = input as Record<string, unknown>;
  if (
    a.application !== application ||
    a.tenant !== tenant ||
    typeof a.identityConfigured !== "boolean" ||
    typeof a.authorized !== "boolean" ||
    (a.oauthAuthorized !== undefined && typeof a.oauthAuthorized !== "boolean")
  )
    throw Error("Invalid runtime access response.");
  return {
    application,
    tenant,
    identityConfigured: a.identityConfigured,
    authorized: a.authorized,
    ...(application === "club-api" && typeof a.oauthAuthorized === "boolean"
      ? { oauthAuthorized: a.oauthAuthorized }
      : {}),
  };
}
export function RuntimeAccessPanel({
  connection,
  tenant,
  tenantToken,
  applications,
  names,
}: {
  connection: { environment: string; tenant: string; token: string };
  tenant: string;
  tenantToken: string;
  applications: string[];
  names: RuntimeConfigurationDocument["applications"];
}) {
  return (
    <section aria-label="Runtime access administration">
      <h3>Runtime access</h3>
      <p>
        Runtime access is separately administered. Saving configuration never
        grants access. Allowing access lets the application identity read this
        tenant’s published bindings; business tenant provisioning and a
        compatible runtime are still required.
      </p>
      {applications.map((application) => (
        <ApplicationTenantAccess
          key={application + "/" + tenant}
          connection={connection}
          tenant={tenant}
          tenantToken={tenantToken}
          application={application}
          displayName={names[application]?.displayName ?? application}
        />
      ))}
    </section>
  );
}
function ApplicationTenantAccess({
  connection,
  tenant,
  tenantToken,
  application,
  displayName,
}: {
  connection: { environment: string; tenant: string; token: string };
  tenant: string;
  tenantToken: string;
  application: string;
  displayName: string;
}) {
  const [access, setAccess] = useState<Access>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<boolean>(),
    [epoch, setEpoch] = useState(0);
  const [oauthChoice, setOauthChoice] = useState(false);
  const [oauthTouched, setOauthTouched] = useState(false);
  function openConfirmation(allow: boolean) {
    setOauthChoice(false);
    setOauthTouched(false);
    setConfirm(allow);
  }
  const controller = useRef<AbortController | undefined>(undefined),
    cancelButton = useRef<HTMLButtonElement>(null);
  async function request(
    signal: AbortSignal,
    allow?: boolean,
    oauth?: boolean,
  ) {
    const response = await fetch(
      "/api/vault/local/runtime-access-control/" +
        encodeURIComponent(application) +
        "/tenants/" +
        encodeURIComponent(tenant),
      {
        method: allow === undefined ? "GET" : "PUT",
        headers: {
          "x-vault-token": connection.token,
          "x-vault-environment": connection.environment,
          "x-vault-tenant": "_shared",
          "x-vault-tenant-tokens": JSON.stringify({ [tenant]: tenantToken }),
          ...(allow === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          allow === undefined
            ? undefined
            : JSON.stringify({
                allow,
                ...(oauth === undefined ? {} : { oauth }),
              }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw Error(
        response.status === 403 || response.status === 401
          ? "Runtime access could not be verified or changed. Existing operator grants need read, write and list permission in _shared and this tenant. Provider enrollment and renewal additionally requires this tenant’s renew permission."
          : "Runtime access request failed. Reload access to check its state before retrying.",
      );
    let input: unknown;
    try {
      input = await response.json();
    } catch {
      throw Error("Invalid runtime access response.");
    }
    return parseAccess(input, application, tenant);
  }
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    setAccess(undefined);
    setConfirm(undefined);
    setError("");
    setBusy(true);
    void request(c.signal)
      .then((next) => {
        if (!c.signal.aborted) setAccess(next);
      })
      .catch((e) => {
        if (!c.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Runtime access unavailable.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setBusy(false);
      });
    return () => c.abort();
  }, [
    connection.environment,
    connection.token,
    tenant,
    tenantToken,
    application,
    epoch,
  ]);
  useEffect(() => {
    if (confirm === undefined) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [confirm]);
  async function change(allow: boolean) {
    const c = controller.current;
    if (!c || c.signal.aborted) return;
    setConfirm(undefined);
    setBusy(true);
    setError("");
    try {
      const next = await request(
        c.signal,
        allow,
        allow && application === "club-api" && oauthTouched
          ? oauthChoice
          : undefined,
      );
      if (!c.signal.aborted) setAccess(next);
    } catch (e) {
      if (!c.signal.aborted) {
        setAccess(undefined);
        setError(
          e instanceof Error ? e.message : "Runtime access unavailable.",
        );
      }
    } finally {
      if (!c.signal.aborted) setBusy(false);
    }
  }
  return (
    <fieldset>
      <legend>
        {displayName} / {tenant}
      </legend>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Checking runtime access…</p>}
      {access && (
        <>
          <p>
            {access.authorized
              ? "Runtime access allowed"
              : "Runtime access not allowed"}
          </p>
          {application === "club-api" && (
            <p>
              {access.oauthAuthorized
                ? "Provider credential enrollment and renewal allowed"
                : "Provider credential enrollment and renewal not allowed"}
            </p>
          )}
          {!access.identityConfigured && (
            <p>
              One-time runtime identity setup required. No runtime identity is
              created by this editor.
            </p>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !access.identityConfigured}
            onClick={() => openConfirmation(!access.authorized)}
            aria-label={
              (access.authorized ? "Revoke" : "Allow") +
              " runtime access for " +
              displayName
            }
          >
            {access.authorized ? "Revoke" : "Allow"} runtime access
          </button>
          {application === "club-api" && access.authorized && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy || !access.identityConfigured}
              onClick={() => openConfirmation(true)}
            >
              Manage provider access for Club API
            </button>
          )}
          <p>
            Binding adoption remains pending until a fresh consumer report
            confirms it. Provider connections and business routes may still be
            pending. Legacy applications require the compatible live runtime
            to be installed and explicitly enabled.
          </p>
        </>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() => setEpoch((n) => n + 1)}
      >
        Reload access for {displayName}
      </button>
      {confirm !== undefined && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={
            confirm ? "Allow runtime access" : "Revoke runtime access"
          }
          className="azure-confirm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setConfirm(undefined);
            }
            if (e.key === "Tab") {
              const buttons =
                e.currentTarget.querySelectorAll<HTMLElement>("button,input");
              const first = buttons[0],
                last = buttons[buttons.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <p>
            {confirm
              ? `Allow ${displayName} to read ${tenant}’s published runtime bindings using its separately configured identity?`
              : `Revoke ${displayName}’s runtime access to ${tenant}? Existing process snapshots may remain in memory until refreshed.`}{" "}
            This changes access independently of configuration Save. No identity
            is issued, no live mode is activated and no service is restarted.
          </p>
          {!confirm && application === "club-api" && (
            <p>
              Revoking runtime access also revokes provider credential
              enrollment and renewal.
            </p>
          )}
          {confirm && application === "club-api" && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={oauthChoice}
                  onChange={(e) => {
                    setOauthChoice(e.target.checked);
                    setOauthTouched(true);
                  }}
                />
                Also allow provider credential enrollment and renewal
              </label>
              <p>
                This separate capability permits Club API to enroll and renew
                provider credentials such as Bexio and Dropbox for this tenant.
                It requires the operator’s exact tenant renew permission as well
                as read, write and list. It does not grant generic Vault write
                access. Leaving this option unchanged preserves existing
                provider permission.
              </p>
            </>
          )}
          <button
            ref={cancelButton}
            type="button"
            className="secondary-button"
            onClick={() => setConfirm(undefined)}
          >
            Cancel access change
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void change(confirm)}
          >
            {confirm
              ? "Confirm allow runtime access"
              : "Confirm revoke runtime access"}
          </button>
        </div>
      )}
    </fieldset>
  );
}
