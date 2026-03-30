import { dailyPipeline } from "./daily-pipeline";
import {
  companyRunCompleted,
  finalizePipelineRequest,
  pipelineRequested,
  processCompanyPipelineRun,
} from "./pipeline-workflow";

export const functions = [
  dailyPipeline,
  pipelineRequested,
  processCompanyPipelineRun,
  companyRunCompleted,
  finalizePipelineRequest,
];
