import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mesocyclesRouter from "./mesocycles";
import trainingRouter from "./training";
import workoutsRouter from "./workouts";
import legendaryV22Router from "./legendary-v22";

const router: IRouter = Router();

router.use(healthRouter);
router.use(legendaryV22Router);
router.use(mesocyclesRouter);
router.use(trainingRouter);
router.use(workoutsRouter);

export default router;
