import { Sandbox } from "@vercel/sandbox";

async function main() {
  console.log("[smoke] Creating sandbox (python3.13 runtime)...");
  const sandbox = await Sandbox.create({
    runtime: "python3.13",
    timeout: 60_000,
  });

  console.log("[smoke] Sandbox created. Running hello-world...");

  const helloProc = await sandbox.runCommand({
    cmd: "echo",
    args: ["hello from sandbox"],
  });
  // stdout/stderr are async methods, not plain strings
  console.log("[smoke] Hello stdout:", await helloProc.stdout());
  console.log("[smoke] Hello exit:", helloProc.exitCode);

  console.log("[smoke] Checking Python availability...");
  const pyVersion = await sandbox.runCommand({
    cmd: "python3",
    args: ["--version"],
  });
  console.log("[smoke] Python stdout:", await pyVersion.stdout());
  console.log("[smoke] Python stderr:", await pyVersion.stderr());
  console.log("[smoke] Python exit:", pyVersion.exitCode);

  console.log("[smoke] Testing pip install of numpy (this is the long pole)...");
  const t0 = Date.now();
  const pipInstall = await sandbox.runCommand({
    cmd: "pip",
    args: ["install", "--quiet", "numpy"],
  });
  console.log("[smoke] pip install took:", Date.now() - t0, "ms");
  console.log("[smoke] pip exit:", pipInstall.exitCode);
  if (pipInstall.exitCode !== 0) {
    console.log("[smoke] pip stderr:", await pipInstall.stderr());
  }

  console.log("[smoke] Running a numpy calculation in Python...");
  const pyExec = await sandbox.runCommand({
    cmd: "python3",
    args: ["-c", "import numpy as np; print(np.percentile([1,2,3,4,5,6,7,8,9,10], 90))"],
  });
  console.log("[smoke] Python stdout:", await pyExec.stdout());
  console.log("[smoke] Python stderr:", await pyExec.stderr());
  console.log("[smoke] Python exit:", pyExec.exitCode);

  // NOTE: stdin is NOT a supported param in RunCommandParams.
  // Workaround: write data to a file, then use sh -c with a pipe/heredoc.
  console.log("[smoke] Testing writeFiles + stdin-via-shell...");
  // writeFiles content must be Buffer per the SDK docs
  await sandbox.writeFiles([
    {
      path: "/tmp/test.py",
      content: Buffer.from("import sys, json; data = json.loads(sys.stdin.read()); print(json.dumps({'doubled': data['n'] * 2}))"),
    },
    {
      path: "/tmp/input.json",
      content: Buffer.from(JSON.stringify({ n: 21 })),
    },
  ]);

  // Feed stdin via shell redirect since stdin param doesn't exist on runCommand
  const stdinProc = await sandbox.runCommand({
    cmd: "sh",
    args: ["-c", "python3 /tmp/test.py < /tmp/input.json"],
  });
  console.log("[smoke] Stdin-via-shell stdout:", await stdinProc.stdout());
  console.log("[smoke] Stdin-via-shell exit:", stdinProc.exitCode);

  await sandbox.stop();
  console.log("[smoke] Done. ✅");
}

main().catch((err) => {
  console.error("[smoke] FAILED:", err);
  process.exit(1);
});
