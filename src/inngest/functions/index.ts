import { dailyPipeline } from "./daily-pipeline";
import { processOrg } from "./process-org";

export const functions = [dailyPipeline, processOrg];
