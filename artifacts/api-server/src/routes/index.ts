import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mesocyclesRouter from "./mesocycles";
import trainingRouter from "./training";
import workoutsRouter from "./workouts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mesocyclesRouter);
router.use(trainingRouter);
router.use(workoutsRouter);

export default router;
