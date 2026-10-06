import { useEffect, useRef, useState } from "react";
import { Check, Lock, Pencil, Trash2, X } from "lucide-react";
import {
  useCompleteWorkoutSet,
  useUpdateWorkoutSet,
} from "@workspace/api-client-react";
import type {
  ExerciseMetricDefinition,
  WorkoutExercise,
  WorkoutSet,
} from "@workspace/api-client-react";
import type { WeightUnit } from "@/lib/units";
import { metricUnitLabel, metricValueToInput } from "@/lib/exercise-metrics";
import { markWorkoutDraftPending, useWorkoutDrafts } from "@/lib/workout-drafts";

const toInputValues = (
  values: (number | null)[] | null | undefined,
  definitions: ExerciseMetricDefinition[],
  unit: WeightUnit,
) => definitions.map((definition, index) =>
  metricValueToInput(values?.[index], definition, unit),
);

export function MetricSetRow({
  set,
  label,
  exercise,
  sessionId,
  unit,
  readOnly,
  locked,
  trainingMode,
  onSaved,
  onError,
  onRemove,
}: {
  set: WorkoutSet;
  label: number;
  exercise: WorkoutExercise;
  sessionId: number;
  unit: WeightUnit;
  readOnly: boolean;
  locked: boolean;
  trainingMode: "basic" | "legendary_pro";
  onSaved: () => void;
  onError: (failed: boolean) => void;
  onRemove: (set: WorkoutSet, needsConfirm: boolean) => void;
}) {
  const definitions = exercise.metricDefinitions ?? [];
  const update = useUpdateWorkoutSet();
  const complete = useCompleteWorkoutSet();
  const drafts = useWorkoutDrafts();
  const [values, setValues] = useState(() =>
    toInputValues(set.metricValues, definitions, unit),
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const latestValues = useRef(values);
  latestValues.current = values;
  const saving = useRef<Promise<void>>(Promise.resolve());
  const version = useRef(0);

  const serverValues = () => toInputValues(set.metricValues, definitions, unit);
  const signature = `${JSON.stringify(set.metricValues)}|${unit}|${set.completed}`;
  useEffect(() => {
    if (dirty.current) return;
    setValues(serverValues());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const parseValues = () => {
    let invalid = false;
    const parsed = latestValues.current.map((text, index) => {
      if (text.trim() === "") return null;
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0) invalid = true;
      const type = definitions[index]?.type;
      if ((type === "reps" || type === "steps") && !Number.isInteger(value)) invalid = true;
      return invalid || !Number.isFinite(value) ? null : value;
    });
    return { parsed, invalid };
  };
  const updateValue = (index: number, value: string) => {
    dirty.current = true;
    markWorkoutDraftPending(set.id, true);
    version.current += 1;
    setValues((old) => old.map((item, itemIndex) => itemIndex === index ? value : item));
  };

  const save = () => {
    const next = saving.current.catch(() => undefined).then(async () => {
      if (!dirty.current || (set.completed && !editingRef.current)) return;
      if (editingRef.current) throw new Error("Save or cancel the completed-set edit first.");
      const { parsed, invalid } = parseValues();
      if (invalid) {
        onError(true);
        throw new Error("Enter non-negative values; repetitions, steps and counts must be whole numbers.");
      }
      const sentVersion = version.current;
      try {
        await update.mutateAsync({
          sessionId,
          setId: set.id,
          data: { metricValues: parsed, completed: false },
        });
        if (version.current === sentVersion) {
          dirty.current = false;
          markWorkoutDraftPending(set.id, false);
        }
        onError(false);
        onSaved();
      } catch (saveError) {
        onError(true);
        throw saveError;
      }
    });
    saving.current = next;
    return next;
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (readOnly || !drafts) return;
    return drafts.register(set.id, () => saveRef.current());
  }, [drafts, readOnly, set.id]);
  const commit = () => {
    if (!editingRef.current) void save().catch(() => undefined);
  };

  const completeSet = () => {
    setError("");
    const { parsed, invalid } = parseValues();
    if (invalid) {
      setError("Enter non-negative values; repetitions, steps and counts must be whole numbers.");
      return;
    }
    const missing = definitions.some((definition, index) =>
      definition.required && parsed[index] === null,
    );
    if (missing) {
      setError("Complete every required metric before logging this set.");
      return;
    }
    setBusy(true);
    const run = saving.current.catch(() => undefined).then(async () => {
      try {
        if (set.setType === "work") {
          await complete.mutateAsync({ sessionId, setId: set.id, data: { metricValues: parsed } });
        } else {
          await update.mutateAsync({
            sessionId,
            setId: set.id,
            data: { metricValues: parsed, completed: true },
          });
        }
        dirty.current = false;
        markWorkoutDraftPending(set.id, false);
        onError(false);
        onSaved();
      } catch {
        setError("Could not complete this set. Your values are still here.");
        throw new Error("Metric set completion failed");
      }
    });
    saving.current = run;
    void run.catch(() => undefined).finally(() => setBusy(false));
  };

  const saveEdit = () => {
    setError("");
    const { parsed, invalid } = parseValues();
    if (invalid || definitions.some((definition, index) =>
      definition.required && parsed[index] === null,
    )) {
      setError(invalid
        ? "Enter non-negative values; repetitions, steps and counts must be whole numbers."
        : "Complete every required metric before saving this edit.");
      return;
    }
    setBusy(true);
    const run = saving.current.catch(() => undefined).then(async () => {
      try {
        await update.mutateAsync({
          sessionId,
          setId: set.id,
          data: { metricValues: parsed, completed: true, editIntent: true },
        });
        dirty.current = false;
        markWorkoutDraftPending(set.id, false);
        setEditing(false);
        onSaved();
      } catch {
        setError("Could not save the edit. The original values are unchanged.");
        throw new Error("Metric set edit failed");
      }
    });
    saving.current = run;
    void run.catch(() => undefined).finally(() => setBusy(false));
  };

  const cancelEdit = () => {
    dirty.current = false;
    markWorkoutDraftPending(set.id, false);
    setEditing(false);
    setError("");
    setValues(serverValues());
  };
  const hasEntered = set.completed || dirty.current || (set.metricValues ?? []).some((value) => value != null);
  const inputsOff = readOnly || locked || (set.completed && !editing);
  const isWork = set.setType === "work";
  const kind = isWork ? "Set" : "Warm-up";

  return <div
    className={`${isWork ? "" : "set-warm"} ${locked && !set.completed ? "set-locked" : ""} ${set.completed && !editing ? "set-done" : ""}`}
    style={{ marginBottom: 12 }}
    data-testid={`row-set-${set.id}`}
  >
    <div style={{
      display: "grid",
      gridTemplateColumns: `minmax(32px,.48fr) repeat(${definitions.length},minmax(0,1fr)) minmax(32px,.5fr)`,
      gap: 5,
      alignItems: "center",
    }}>
      <div className="set-num" title={isWork ? "Working set" : "Warm-up set"} style={isWork
        ? { background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }
        : { background: "transparent", border: "1px dashed hsl(var(--muted-foreground))", color: "hsl(var(--muted-foreground))" }}>
        {isWork ? label : `W${label}`}
      </div>
      {definitions.map((definition, index) => (
        <input
          key={`${definition.label}-${index}`}
          aria-label={`${kind} ${label} ${definition.label}${definition.required ? " required" : ""}`}
          data-testid={`input-set-metric-${set.id}-${index + 1}`}
          type="number"
          inputMode={["reps", "steps"].includes(definition.type) ? "numeric" : "decimal"}
          step={["reps", "steps"].includes(definition.type) ? 1 : "any"}
          min="0"
          className="set-input"
          placeholder={`${definition.label}${definition.required ? " *" : ""}`}
          value={values[index] ?? ""}
          disabled={inputsOff}
          onChange={(event) => updateValue(index, event.currentTarget.value)}
          onBlur={commit}
        />
      ))}
      <span className="set-head" style={{ fontSize: 8, display: "grid", placeItems: "center" }}>
        {locked && !set.completed ? <Lock size={13}/> : set.completed ? <Check size={14} color="hsl(var(--primary))"/> : ""}
      </span>
    </div>
    {isWork && <div style={{ fontSize: 10.5, color: "hsl(var(--muted-foreground))", margin: "4px 0 0 39px", lineHeight: 1.4 }}>
      {definitions.map((definition) => `${definition.label} (${metricUnitLabel(definition, unit)}${definition.required ? ", required" : ", optional"})`).join(" · ")}
    </div>}
    {error && <div role="alert" style={{ margin: "5px 0 0 39px", fontSize: 12, color: "hsl(var(--destructive))" }}>{error}</div>}
    {!readOnly && <div style={{ display: "flex", gap: 6, margin: "7px 0 0 39px", alignItems: "center" }}>
      {!set.completed && !locked && <button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={busy} onClick={completeSet} data-testid={`button-complete-set-${set.id}`}>
        <Check size={15}/> {busy ? "Saving…" : trainingMode === "legendary_pro" && isWork ? "Complete set" : "Log set"}
      </button>}
      {set.completed && !editing && <button className="btn btn-outline btn-sm" onClick={() => { setEditing(true); setError(""); }} data-testid={`button-edit-set-${set.id}`}><Pencil size={13}/> Edit</button>}
      {editing && <>
        <button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={busy} onClick={saveEdit} data-testid={`button-save-edit-${set.id}`}><Check size={15}/> Save edit</button>
        <button className="btn btn-outline btn-sm" disabled={busy} onClick={cancelEdit}><X size={14}/> Cancel</button>
      </>}
      <button className="btn btn-danger btn-sm" style={{ marginLeft: "auto", minWidth: 42 }} aria-label={`Remove ${kind.toLowerCase()} ${label}`} disabled={busy} onClick={() => onRemove(set, hasEntered)} data-testid={`button-remove-set-${set.id}`}><Trash2 size={15}/></button>
    </div>}
  </div>;
}
