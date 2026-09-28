import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SharpImageProcessor } from "./media/ImageProcessor.js";

async function main(): Promise<void> {
  const tmpDir = process.env.WORKER_TMP_DIR ?? join(process.cwd(), ".worker-tmp");
  await mkdir(tmpDir, { recursive: true });

  // The real app wires Supabase/R2 adapters here. This entrypoint exists so the
  // package has a stable process boundary without inventing a second DB contract.
  new SharpImageProcessor();
  console.log("Upload processing worker package ready. Wire db/storage adapters before starting BullMQ workers.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
