import { useEffect, useState } from "react";
import { api, HttpError, type AppState } from "./api";

type Action = "load" | "increment" | "decrement" | "reset" | "refresh";
type TrackProps = Record<string, string | number | boolean>;

// Seam for Pendo. Novus installs the Pendo agent, which provides window.pendo
// at runtime; this fires a Track Event for each action. No-op when the agent
// isn't present (local dev), so the app and Playwright mocks both stay simple.
// Sends demo-load, demo-increment, demo-decrement, demo-reset, demo-refresh and
// demo-action-failed. Pendo matches these names exactly, so don't rename them.
function trackEvent(name: Action | "action-failed", props: TrackProps) {
  if (typeof window !== "undefined") {
    window.pendo?.track?.(`demo-${name}`, props);
  }
}

// Properties for a successful action. `prev` is the state the user saw when
// they acted; `next` is the server's response.
function successProps(action: Action, prev: AppState, next: AppState): TrackProps {
  switch (action) {
    case "load":
      return { counter: next.counter, lastAction: next.lastAction };
    case "increment":
    case "decrement":
      // counter isn't previousCounter ± 1 when the shared counter changed in
      // between (another tab or client, or overlapping clicks).
      return { counter: next.counter, previousCounter: prev.counter };
    case "reset":
      // counter is always 0 after a reset, so report what the reset erased.
      return { previousCounter: prev.counter, previousLastAction: prev.lastAction };
    case "refresh":
      return {
        // The UI was out of date, e.g. another tab or client changed the counter.
        stateChanged: next.counter !== prev.counter || next.lastAction !== prev.lastAction,
        counter: next.counter,
        lastAction: next.lastAction,
        previousCounter: prev.counter,
      };
  }
}

// Properties for a failed action. errorName tells the failure kinds apart:
// "Error" = HTTP error status, "TypeError" = network/CORS failure,
// "SyntaxError" = response wasn't valid JSON.
function failureProps(action: Action, e: unknown): TrackProps {
  const err = e instanceof Error ? e : new Error(String(e));
  const props: TrackProps = {
    action,
    // Capped to stay well within Pendo's 512-byte limit for event properties.
    errorMessage: err.message.slice(0, 200),
    errorName: err.name,
  };
  if (err instanceof HttpError) props.httpStatus = err.status;
  return props;
}

// StrictMode runs mount effects twice in development. This module-level flag
// keeps the initial load to one Track Event per page load.
let initialLoadTracked = false;

export default function App() {
  const [state, setState] = useState<AppState>({ counter: 0, lastAction: "none" });
  const [error, setError] = useState<string | null>(null);

  const run = async (action: Action, fn: () => Promise<AppState>, track = true) => {
    const prev = state;
    try {
      setError(null);
      const next = await fn();
      setState(next);
      if (track) trackEvent(action, successProps(action, prev, next));
    } catch (e) {
      setError((e as Error).message);
      if (track) trackEvent("action-failed", failureProps(action, e));
    }
  };

  useEffect(() => {
    // Only the first run is tracked (see initialLoadTracked).
    const track = !initialLoadTracked;
    initialLoadTracked = true;
    run("load", api.getState, track);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 480, margin: "4rem auto", textAlign: "center" }}>
      <h1>QAWolf Demo</h1>

      <p data-testid="counter-value" style={{ fontSize: "3rem", margin: "1rem 0" }}>
        {state.counter}
      </p>
      <p data-testid="last-action" style={{ color: "#666" }}>
        Last action: {state.lastAction}
      </p>

      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
        <button data-testid="btn-increment" onClick={() => run("increment", api.increment)}>
          Increment
        </button>
        <button data-testid="btn-decrement" onClick={() => run("decrement", api.decrement)}>
          Decrement
        </button>
        <button data-testid="btn-reset" onClick={() => run("reset", api.reset)}>
          Reset
        </button>
        <button data-testid="btn-refresh" onClick={() => run("refresh", api.getState)}>
          Refresh
        </button>
      </div>

      {error && (
        <p data-testid="error" style={{ color: "crimson", marginTop: 16 }}>
          {error}
        </p>
      )}
    </main>
  );
}
