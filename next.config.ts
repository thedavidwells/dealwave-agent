import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
    // PPR via `cacheComponents` was considered and tested for /deals,
    // but rolled back for this build. The cacheComponents model is
    // opinionated about what's cacheable (forbids Math.random in
    // Client Components without Suspense boundaries, forbids the
    // legacy `dynamic` / `revalidate` route segment configs, etc.) and
    // the migration cost wasn't worth it for the interview demo. The
    // current rendering story is still two strategies:
    //   - /deals/[id] uses ISR (export const revalidate = 60) so the
    //     deal record is cached at the edge for a minute.
    //   - /deals uses regular Suspense streaming around the async
    //     DealsGrid server component — same visible UX as PPR, just
    //     without the static-shell prerendering optimization.
    // Adding PPR is a follow-up once every route has been audited
    // against cacheComponents' constraints.
    images: {
        // Allow next/image to optimize the property hero on /deals/[id]
        // and the deal-card thumbnails on /deals.
        //
        // DealWave's production pipeline (verified in
        // property-image.service.ts:651 — `tryZenRowsImageOnly` calls
        // `downloadValidateAndUploadImage` which re-uploads scraped
        // images to Supabase Storage and returns the public CDN URL).
        // The Supabase wildcard subdomain is the production source. The
        // pathname is restricted to the public storage object path so a
        // typo or malicious deal record can't redirect the optimizer to
        // an arbitrary endpoint on supabase.co.
        //
        // images.unsplash.com is allowlisted for test deals where a
        // hardcoded Unsplash placeholder was used during early API
        // verification (before the real image pipeline was live). Real
        // production deals don't go through this hostname.
        remotePatterns: [
            {
                protocol: "https",
                hostname: "*.supabase.co",
                pathname: "/storage/v1/object/public/**",
            },
            {
                protocol: "https",
                hostname: "images.unsplash.com",
            },
            {
                // Zillow's image CDN — production analyze runs return
                // Zillow URLs directly (e.g.
                // photos.zillowstatic.com/fp/<hash>-p_f.jpg). Verified
                // from the next/image runtime error after running an
                // analyze on a real Phoenix property.
                protocol: "https",
                hostname: "photos.zillowstatic.com",
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
