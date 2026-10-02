import { Router } from "express";
import { DeleteMesocyclePreservingHistoryQueryParams, ResetTrainingDataBody } from "@workspace/api-zod";
import { deleteMesocyclePreservingHistory, resetTrainingData } from "../lib/training-data";
const router = Router();
function identifier(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid identifier");
  return id;
}
router.delete("/mesocycles/:splitId", async (req, res) => {
  try {
    const input = DeleteMesocyclePreservingHistoryQueryParams.parse(req.query);
    await deleteMesocyclePreservingHistory(identifier(req.params.splitId), input.profileId);
    res.sendStatus(204);
  } catch (error) { res.status(error instanceof Error && error.message.includes("not found") ? 404 : 400).json({ error: error instanceof Error ? error.message : "Deletion failed" }); }
});
router.post("/profiles/:profileId/reset-training", async (req, res) => {
  try {
    const input = ResetTrainingDataBody.parse(req.body);
    await resetTrainingData(identifier(req.params.profileId), input.confirmation);
    res.sendStatus(204);
  } catch (error) { res.status(error instanceof Error && error.message.includes("not found") ? 404 : 400).json({ error: error instanceof Error ? error.message : "Reset failed" }); }
});
export default router;