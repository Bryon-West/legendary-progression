import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Settings2, UserPlus, X } from "lucide-react";
import { Link } from "wouter";
import {
  getListBetaFeedbackManagersQueryKey,
  getListBetaFeedbackQueryKey,
  useGrantBetaFeedbackManager,
  useListBetaFeedbackManagers,
  useRevokeBetaFeedbackManager,
} from "@workspace/api-client-react";
import type { BetaFeedbackManager } from "@workspace/api-client-react";
import { Empty, ErrorNote, QueryError } from "@/components/ui-bits";
import { Modal } from "@/components/modal";

export default function BetaFeedbackManagersPage() {
  const queryClient = useQueryClient();
  const managersQuery = useListBetaFeedbackManagers({
    query: { queryKey: getListBetaFeedbackManagersQueryKey() },
  });
  const grant = useGrantBetaFeedbackManager();
  const revoke = useRevokeBetaFeedbackManager();
  const [search, setSearch] = useState("");
  const [actionError, setActionError] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<BetaFeedbackManager | null>(null);
  const managers = managersQuery.data?.managers ?? [];
  const candidates = managersQuery.data?.candidates ?? [];
  const filteredCandidates = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return candidates;
    return candidates.filter((candidate) =>
      candidate.name.toLocaleLowerCase().includes(needle) ||
      String(candidate.profileId).includes(needle),
    );
  }, [candidates, search]);

  const refreshRoles = async () => {
    await queryClient.invalidateQueries({ queryKey: getListBetaFeedbackManagersQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getListBetaFeedbackQueryKey() });
  };

  const grantManager = async (profileId: number) => {
    setActionError("");
    try {
      await grant.mutateAsync({ data: { targetProfileId: profileId } });
      setSearch("");
      await refreshRoles();
    } catch {
      setActionError("Feedback manager access could not be granted. Refresh the list and try again.");
    }
  };

  const revokeManager = async () => {
    if (!revokeTarget) return;
    setActionError("");
    try {
      await revoke.mutateAsync({ targetProfileId: revokeTarget.profileId });
      setRevokeTarget(null);
      await refreshRoles();
    } catch {
      setActionError("Feedback manager access could not be revoked. Refresh the list and try again.");
    }
  };

  return (
    <main className="page-wrap enter" data-testid="page-beta-feedback-managers">
      <Link href="/feedback" className="btn btn-ghost btn-sm" style={{ textDecoration: "none", margin: "-8px 0 12px" }}>
        <ArrowLeft size={15} /> Feedback
      </Link>
      <div className="eyebrow">Feedback access · owner only</div>
      <h1 className="display" style={{ fontSize: "clamp(38px, 11vw, 50px)", margin: "7px 0 8px" }}>Manage reviewers</h1>
      <p style={{ margin: "0 0 20px", color: "hsl(var(--muted-foreground))", fontSize: 13, lineHeight: 1.55 }}>
        Reviewers can update or remove beta feedback only. This role does not grant access to training records, account settings, or other administration.
      </p>

      {actionError && <div className="notice-warn" role="alert" style={{ marginBottom: 12 }}>{actionError}</div>}
      {managersQuery.isLoading ? (
        <div className="panel" style={{ padding: 18 }}><div className="skeleton" style={{ height: 18, width: "60%" }} /></div>
      ) : managersQuery.isError ? (
        <QueryError retry={() => void managersQuery.refetch()} />
      ) : (
        <>
          <section className="panel manager-panel" aria-labelledby="feedback-managers-title">
            <div className="manager-panel__heading">
              <span className="feedback-icon"><Settings2 size={17} /></span>
              <div>
                <div className="eyebrow">Persistent access</div>
                <h2 id="feedback-managers-title" style={{ margin: "3px 0 0", fontSize: 18 }}>Current managers</h2>
              </div>
            </div>
            {managers.length ? (
              <div className="manager-list">
                {managers.map((manager) => (
                  <article className="manager-row" key={manager.profileId} data-testid={`manager-row-${manager.profileId}`}>
                    <div className="manager-row__name">
                      <strong>{manager.name || "Unnamed profile"}</strong>
                      <small>Profile #{manager.profileId}</small>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={revoke.isPending}
                      onClick={() => setRevokeTarget(manager)}
                      data-testid={`button-revoke-manager-${manager.profileId}`}
                    >
                      <X size={14} /> Revoke
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="No feedback managers yet" detail="Grant a role below when someone needs to help review feedback." />
            )}
          </section>

          <section className="panel manager-panel" aria-labelledby="feedback-candidates-title">
            <div className="manager-panel__heading">
              <span className="feedback-icon"><UserPlus size={17} /></span>
              <div>
                <div className="eyebrow">Existing accounts only</div>
                <h2 id="feedback-candidates-title" style={{ margin: "3px 0 0", fontSize: 18 }}>Grant manager access</h2>
              </div>
            </div>
            <label className="manager-search" htmlFor="feedback-manager-search">
              <Search size={16} aria-hidden="true" />
              <input
                id="feedback-manager-search"
                type="search"
                className="field"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Find a profile by name or ID"
                autoComplete="off"
                data-testid="input-feedback-manager-search"
              />
            </label>
            {filteredCandidates.length ? (
              <div className="manager-list">
                {filteredCandidates.map((candidate) => (
                  <article className="manager-row" key={candidate.profileId} data-testid={`candidate-row-${candidate.profileId}`}>
                    <div className="manager-row__name">
                      <strong>{candidate.name || "Unnamed profile"}</strong>
                      <small>Profile #{candidate.profileId}</small>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={grant.isPending}
                      onClick={() => void grantManager(candidate.profileId)}
                      data-testid={`button-grant-manager-${candidate.profileId}`}
                    >
                      <UserPlus size={14} /> Grant
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={candidates.length ? "No profiles match" : "No eligible profiles"}
                detail={candidates.length ? "Try a different name or profile ID." : "Only profiles linked to an existing signed-in account can receive this role."}
              />
            )}
            {grant.isPending && <p className="manager-help" role="status">Saving role…</p>}
          </section>
        </>
      )}

      {revokeTarget && <Modal title="Revoke feedback manager access?" close={() => { if (!revoke.isPending) setRevokeTarget(null); }}>
        <p style={{ color: "hsl(var(--muted-foreground))", fontSize: 13, lineHeight: 1.55 }}>
          {revokeTarget.name || "This profile"} will no longer be able to change or remove feedback. Their training data and existing feedback entries will not be changed.
        </p>
        <div className="feedback-confirm-actions">
          <button type="button" className="btn btn-secondary" disabled={revoke.isPending} onClick={() => setRevokeTarget(null)}>Keep access</button>
          <button type="button" className="btn btn-danger" disabled={revoke.isPending} onClick={() => void revokeManager()} data-testid="button-confirm-revoke-manager">
            {revoke.isPending ? "Revoking…" : "Revoke access"}
          </button>
        </div>
      </Modal>}
    </main>
  );
}
