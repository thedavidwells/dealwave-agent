import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  /* config options here */
};

// Wrap with withWorkflow() to enable the 'use workflow' and 'use step'
// directives. Without this, functions marked with 'use workflow' run as
// regular async functions and any reviewHook.create() call throws
// `defineHook().create() can only be called inside a workflow function`.
// The wrapper installs the build-time transformation that registers
// workflows with Vercel's durable execution runtime.
export default withWorkflow(nextConfig);
