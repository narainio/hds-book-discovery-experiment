import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import discoveryRouter from "./discovery";
import commerceRouter from "./commerce";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(discoveryRouter);
router.use(commerceRouter);

export default router;
