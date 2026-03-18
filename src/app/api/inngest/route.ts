import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const maxDuration = 800;

export const { GET, POST, PUT } = serve({ client: inngest, functions });
