import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mesocyclesRouter from "./mesocycles";
import trainingRouter from "./training";
import workoutsRouter from "./workouts";
import legendaryV22Router from "./legendary-v22";
import trainingDataRouter from "./training-data";

const router: IRouter = Router();
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.use(healthRouter);
router.use(trainingDataRouter);
router.use(legendaryV22Router);
router.use(mesocyclesRouter);
router.use(trainingRouter);
router.use(workoutsRouter);

export default router;
