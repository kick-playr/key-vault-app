"use client";
import React, { useState } from "react";
export function KeyRotationPanel({
  instances,
  onRetire,
}: {
  instances: { _id: string; applicationId: string; retired: boolean }[];
  onRetire: (id: string, confirmation: string, reason: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [reason, setReason] = useState("");
  return (
    <section>
      <h3>Application instances</h3>
      <p>
        Disconnected instances continue to block key activation. Retire one only
        after verifying that the process is permanently stopped.
      </p>
      {instances
        .filter((i) => !i.retired)
        .map((instance) => (
          <div
            key={instance._id}
            style={{
              display: "flex",
              gap: 12,
              padding: 8,
              alignItems: "center",
            }}
          >
            <code>{instance._id}</code>
            <span>{instance.applicationId}</span>
            <button
              onClick={() => {
                setSelected(instance._id);
                setConfirmation("");
                setReason("");
              }}
            >
              Retire stopped instance
            </button>
          </div>
        ))}
      {selected && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await onRetire(selected, confirmation, reason);
            setSelected("");
          }}
        >
          <p>
            Type <code>PERMANENTLY STOPPED {selected}</code>
          </p>
          <input
            aria-label="Permanent stop confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <input
            aria-label="Retirement reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            disabled={
              confirmation !== `PERMANENTLY STOPPED ${selected}` ||
              !reason.trim()
            }
          >
            Confirm permanent stop
          </button>
          <button type="button" onClick={() => setSelected("")}>
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
