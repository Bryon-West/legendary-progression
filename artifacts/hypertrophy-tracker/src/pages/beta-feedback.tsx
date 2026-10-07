import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, MessageSquarePlus, Settings2, Trash2 } from "lucide-react";
import { Link } from "wouter";
import {
  getListBetaFeedbackQueryKey,
  useCreateBetaFeedback,
  useDeleteBetaFeedback,
  useListBetaFeedback,
  useUpdateBetaFeedbackStatus,
} from "@workspace/api-client-react";
import type { BetaFeedbackCategory, BetaFeedbackEntry, BetaFeedbackStatus } from "@workspace/api-client-react";
import { Empty, ErrorNote, QueryError } from "@/components/ui-bits";
import { Modal } from "@/components/modal";

const categories: Array<{ value: BetaFeedbackCategory; label: string; detail: string }> = [
  { value: "bug", label: "Bug", detail: "Something did not work" },
  { value: "missing", label: "Missing", detail: "A feature or option" },
  { value: "suggestion", label: "Suggestion", detail: "An improvement idea" },
  { value: "confusing", label: "Confusing", detail: "A rough or unclear moment" },
];

const statusLabels: Record<BetaFeedbackStatus, string> = {
  reported: "Reported",
  planned: "Planned",
  fixed: "Fixed",
};

const statusTone: Record<BetaFeedbackStatus, string> = {
  reported: "feedback-status--reported",
  planned: "feedback-status--planned",
  fixed: "feedback-status--fixed",
};

function displayDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export default function BetaFeedbackPage() {
  const queryClient = useQueryClient();
  const list = useListBetaFeedback({ query: { queryKey: getListBetaFeedbackQueryKey() } });
  const create = useCreateBetaFeedback();
  const updateStatus = useUpdateBetaFeedbackStatus();
  const remove = useDeleteBetaFeedback();
  const [category, setCategory] = useState<BetaFeedbackCategory>("suggestion");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BetaFeedbackEntry | null>(null);
  const [actionError, setActionError] = useState("");
  const entries = list.data?.entries ?? [];
  const canManage = list.data?.canManage === true;
  const canManageManagers = list.data?.canManageManagers === true;

  const submitFeedback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanDescription = description.trim();
    if (cleanDescription.length < 5 || cleanDescription.length > 2000) {
      setFormError("Description must be between 5 and 2,000 characters.");
      return;
    }
    setFormError("");
    setSuccess(false);
    try {
      await create.mutateAsync({ data: { category, description: cleanDescription } });
      setDescription("");
      setSuccess(true);
      await queryClient.invalidateQueries({ queryKey: getListBetaFeedbackQueryKey() });
    } catch {
      setFormError("Feedback could not be submitted. Your draft is still here; try again.");
    }
  };

  const changeStatus = async (entry: BetaFeedbackEntry, status: BetaFeedbackStatus) => {
    if (!canManage || status === entry.status || updateStatus.isPending) return;
    setActionError("");
    try {
      await updateStatus.mutateAsync({ feedbackId: entry.id, data: { status } });
      await queryClient.invalidateQueries({ queryKey: getListBetaFeedbackQueryKey() });
    } catch {
      setActionError("Status could not be updated. Try again.");
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget || !canManage) return;
    setActionError("");
    try {
      await remove.mutateAsync({ feedbackId: removeTarget.id });
      setRemoveTarget(null);
      await queryClient.invalidateQueries({ queryKey: getListBetaFeedbackQueryKey() });
    } catch {
      setActionError("Feedback could not be removed. Try again.");
    }
  };

  return (
    <main className="page-wrap enter" data-testid="page-beta-feedback">
      <div className="eyebrow">Legendary Progression · beta</div>
      <h1 className="display" style={{ fontSize: "clamp(42px, 12vw, 54px)", margin: "8px 0 7px" }}>Help us<br />make it better.</h1>
      <p style={{ margin: "0 0 22px", color: "hsl(var(--muted-foreground))", fontSize: 13, lineHeight: 1.55 }}>
        Clear feedback makes the next session better. Report what happened, not your account details.
      </p>

      <form className="panel" onSubmit={submitFeedback} style={{ padding: 16, marginBottom: 23 }} data-testid="form-beta-feedback">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="feedback-icon"><MessageSquarePlus size={17} /></span>
          <div>
            <div className="eyebrow">Send feedback</div>
            <h2 style={{ margin: "3px 0 0", fontSize: 18 }}>What should we know?</h2>
          </div>
        </div>
        <div className="feedback-category-grid" role="group" aria-label="Feedback category" style={{ marginTop: 16 }}>
          {categories.map((item) => (
            <button
              type="button"
              className="feedback-category"
              key={item.value}
              aria-pressed={category === item.value}
              onClick={() => setCategory(item.value)}
              data-testid={`button-feedback-category-${item.value}`}
            >
              <strong>{item.label}</strong><small>{item.detail}</small>
            </button>
          ))}
        </div>
        <label htmlFor="feedback-description" className="eyebrow" style={{ display: "block", margin: "16px 0 7px" }}>Description</label>
        <textarea
          id="feedback-description"
          className="feedback-textarea"
          value={description}
          minLength={5}
          maxLength={2000}
          placeholder="What happened? What did you expect instead?"
          onChange={(event) => { setDescription(event.target.value); setFormError(""); setSuccess(false); }}
          aria-describedby="feedback-char-count"
          data-testid="input-feedback-description"
        />
        <div className="feedback-form-footer">
          <span id="feedback-char-count" className="metric" style={{ color: description.trim().length < 5 ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))" }}>
            {description.length.toLocaleString()} / 2,000
          </span>
          <button type="submit" className="btn btn-primary" disabled={create.isPending} data-testid="button-submit-feedback">
            {create.isPending ? "Sending…" : "Send feedback"}
          </button>
        </div>
        <div style={{ color: "hsl(var(--muted-foreground))", fontSize: 11, marginTop: 9 }}>
          Keep it between 5 and 2,000 characters. Please leave out email addresses and other private account details.
        </div>
        {formError && <ErrorNote message={formError} />}
        {success && <div className="notice-ok" role="status" style={{ marginTop: 10 }}><Check size={15} style={{ verticalAlign: "middle", marginRight: 5 }} />Feedback received. Thanks for the clear signal.</div>}
      </form>

      <section aria-labelledby="feedback-list-title">
        <div className="feedback-list-heading">
          <div>
            <div className="eyebrow">From athletes</div>
            <h2 id="feedback-list-title" className="display" style={{ fontSize: 32, margin: "4px 0 0" }}>Beta feedback</h2>
          </div>
          {!list.isLoading && !list.isError && <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canManageManagers && <Link href="/feedback/managers" className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }} data-testid="link-feedback-managers"><Settings2 size={14} /> Managers</Link>}
            <span className="badge" data-testid="text-feedback-count">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
          </div>}
        </div>
        {actionError && <div className="notice-warn" role="alert" style={{ margin: "12px 0" }}>{actionError}</div>}
        {list.isLoading ? <div className="feedback-list" aria-label="Loading feedback">
          {[0, 1, 2].map((item) => <div key={item} className="panel" style={{ padding: 17 }}><div className="skeleton" style={{ height: 15, width: "38%", marginBottom: 13 }} /><div className="skeleton" style={{ height: 48, marginBottom: 15 }} /><div className="skeleton" style={{ height: 12, width: "54%" }} /></div>)}
        </div> : list.isError ? <QueryError retry={() => void list.refetch()} /> : entries.length === 0 ? (
          <Empty title="No feedback yet" detail="Be the first to call out a rough edge or a useful next step." />
        ) : (
          <div className="feedback-list">
            {entries.map((entry) => (
              <article className="panel feedback-card" key={entry.id} data-testid={`card-feedback-${entry.id}`}>
                <div className="feedback-card__top">
                  <span className={`badge feedback-category-tag feedback-category-tag--${entry.category}`}>{entry.category}</span>
                  <span className={`feedback-status ${statusTone[entry.status]}`} data-testid={`status-feedback-${entry.id}`}>{entry.status}</span>
                </div>
                <p className="feedback-description">{entry.description}</p>
                <div className="feedback-meta">
                  <span>{entry.reporterName}</span><span aria-hidden="true">·</span><time dateTime={entry.createdAt}>{displayDate(entry.createdAt)}</time>
                </div>
                {canManage && <div className="feedback-admin">
                  <label className="eyebrow" htmlFor={`feedback-status-${entry.id}`}>Manager status</label>
                  <select
                    id={`feedback-status-${entry.id}`}
                    className="field feedback-status-select"
                    value={entry.status}
                    disabled={updateStatus.isPending}
                    onChange={(event) => void changeStatus(entry, event.target.value as BetaFeedbackStatus)}
                    data-testid={`select-feedback-status-${entry.id}`}
                  >
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setRemoveTarget(entry)} data-testid={`button-remove-feedback-${entry.id}`}>
                    <Trash2 size={15} /> Remove
                  </button>
                </div>}
              </article>
            ))}
          </div>
        )}
      </section>

      {removeTarget && <Modal title="Remove this feedback?" close={() => { if (!remove.isPending) setRemoveTarget(null); }}>
        <div className="feedback-confirm-copy">
          <CircleAlert size={20} />
          <p>This permanently removes this feedback entry. This action cannot be undone.</p>
        </div>
        <div className="feedback-confirm-preview">{removeTarget.description}</div>
        <div className="feedback-confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setRemoveTarget(null)} disabled={remove.isPending}>Keep entry</button>
          <button type="button" className="btn btn-destructive" onClick={() => void confirmRemove()} disabled={remove.isPending} data-testid="button-confirm-remove-feedback">
            {remove.isPending ? "Removing…" : "Remove entry"}
          </button>
        </div>
        {actionError && <ErrorNote message={actionError} />}
      </Modal>}
    </main>
  );
}
