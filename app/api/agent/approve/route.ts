// app/api/agent/approve/route.ts
//
// Resume endpoint for the Workflow SDK review hook.
//
// When the user marks a saved deal as reviewed (or skipped) in the UI,
// the client POSTs here with the deal ID + decision. We forward to
// `reviewHook.resume()` which unblocks the corresponding waiting
// dealReviewWorkflow.
//
// This is the OUTSIDE caller that pairs with the workflow's
// `reviewHook.create({ token })` INSIDE the workflow. The Workflow
// SDK matches by token to deliver the event to the right workflow
// instance.
//
// Production extensions:
// - Auth: today this endpoint is open; in production it'd verify the
//   caller owns the deal (auth.uid() matches deal's account_id).
// - Rate limiting: prevent abuse / spam resume calls.
// - Idempotency: handle duplicate resumes gracefully (currently the
//   workflow's for-await loop returns on first event, so duplicates
//   are no-ops).

import { reviewHook } from "@/lib/hooks/approval";

interface ApproveBody {
    token: string;
    decision: "reviewed" | "skipped";
    notes?: string;
}

export async function POST(req: Request) {
    let body: ApproveBody;

    try {
        body = (await req.json()) as ApproveBody;
    } catch {
        return Response.json(
            { error: "Invalid JSON body" },
            { status: 400 },
        );
    }

    if (
        !body.token ||
        (body.decision !== "reviewed" && body.decision !== "skipped")
    ) {
        return Response.json(
            {
                error: "Required: { token: string, decision: 'reviewed' | 'skipped', notes?: string }",
            },
            { status: 400 },
        );
    }

    // Resume the waiting workflow. Workflow SDK looks up the workflow
    // instance by token and delivers this event to its hook iteration.
    await reviewHook.resume(body.token, {
        decision: body.decision,
        notes: body.notes,
    });

    return Response.json({
        ok: true,
        resumed: body.token,
        decision: body.decision,
    });
}
