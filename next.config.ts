import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
    images: {
        // Allow next/image to optimize the property hero on /deals/[id].
        // DealWave's analyze pipeline stores property photos in Supabase
        // Storage as a side-effect, returning the public CDN URL on the
        // deal record's `property_image_url` field. Pattern is the
        // wildcard project subdomain since we don't pin to a specific
        // project ref in env — if we ever lock to one project, tighten
        // this to that exact hostname instead. `pathname` is restricted
        // to the public storage object path so a typo or malicious deal
        // record can't redirect the optimizer to an arbitrary endpoint
        // on supabase.co.
        remotePatterns: [
            {
                protocol: "https",
                hostname: "*.supabase.co",
                pathname: "/storage/v1/object/public/**",
            },
        ],
    },
};

// Wrap with withWorkflow() to enable the 'use workflow' and 'use step'
// directives. Without this, functions marked with 'use workflow' run as
// regular async functions and any reviewHook.create() call throws
// `defineHook().create() can only be called inside a workflow function`.
// The wrapper installs the build-time transformation that registers
// workflows with Vercel's durable execution runtime.
export default withWorkflow(nextConfig);
