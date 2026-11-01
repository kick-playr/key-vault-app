import React, { useEffect, useRef } from "react";
export function DiscardDialog({
  onStay,
  onDiscard,
}: {
  onStay: () => void;
  onDiscard: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Unsaved changes"
      aria-describedby="discard-description"
      className="azure-confirm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onStay();
        }
        if (e.key === "Tab") {
          const buttons =
            e.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          const target = e.shiftKey ? buttons[buttons.length - 1] : buttons[0];
          if (
            (!e.shiftKey &&
              document.activeElement === buttons[buttons.length - 1]) ||
            (e.shiftKey && document.activeElement === buttons[0])
          ) {
            e.preventDefault();
            target?.focus();
          }
        }
      }}
    >
      <p id="discard-description">
        Discard unsaved input? Leaving does not undo a submitted operation.
      </p>
      <button ref={first} onClick={onStay}>
        Stay
      </button>
      <button onClick={onDiscard}>Discard changes</button>
    </div>
  );
}
