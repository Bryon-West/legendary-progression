import { Router, type IRouter } from "express";
import healthRouter from "./health";
import trainingRouter from "./training";
import workoutsRouter from "./workouts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(trainingRouter);
router.use(workoutsRouter);

export default router;
