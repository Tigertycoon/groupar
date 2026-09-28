import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

let child, base;
const group = "grp_fixture_ar_test";
before(async () => {
  child = spawn(process.execPath, [fileURLToPath(new URL("server.mjs", import.meta.url))], {
    env: { ...process.env, GROUPAR_API_PORT: "0", GROUPAR_API_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("API startup timed out")), 15000);
    let output = "";
    child.stdout.on("data", data => {
      output += data;
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { base = match[1]; clearTimeout(timer); resolve(); }
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`API exited: ${code}`)); });
  });
});
after(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, "exit"); child.kill(); await exited;
  }
});
const get = (path, init) => fetch(base + path, init);
const post = (path, body) => get(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("one local server serves the dashboard, scripts and manifest fixture", async () => {
  const page = await get("/");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('id="app"'));
  const script = await get("/dashboard/app.js");
  assert.equal(script.status, 200);
  assert.ok(script.headers.get("content-type").startsWith("text/javascript"));
  const fixture = await get("/fixtures/manifest-test-group-v1.json");
  assert.equal((await fixture.json()).targets.length, 4);
});

test("manifest supports ETag revalidation and HEAD without changing its contract", async () => {
  const response = await get(`/groups/${group}/manifest`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  assert.equal(manifest.schemaVersion, "1.0");
  assert.equal(manifest.targets.length, 4);
  assert.equal(manifest.content.length, 5);
  const etag = response.headers.get("etag"); assert.ok(etag);
  const unchanged = await get(`/api/v1/groups/${group}/manifest`, { headers: { "If-None-Match": etag } });
  assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), "");
  const head = await get(`/groups/${group}/manifest`, { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
});

test("every manifest asset is independently served with matching bytes and SHA256", async () => {
  const manifest = await (await get(`/groups/${group}/manifest`)).json();
  for (const entry of [...manifest.content, ...manifest.targets.map(target => target.image)]) {
    const response = await get(new URL(entry.url).pathname);
    assert.equal(response.status, 200, entry.url);
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(data.length, entry.byteSize);
    assert.equal(createHash("sha256").update(data).digest("hex"), entry.sha256);
    assert.equal(response.headers.get("content-type"), entry.contentType);
  }
});

test("a newly created draft cannot be published without its trigger and media", async () => {
  const created = await post(`/groups/${group}/artworks`, { title: "Contract test" });
  assert.equal(created.status, 201);
  const { revision } = await created.json();
  assert.equal(revision.status, "draft");
  const status = await (await get(`/revisions/${revision.id}/status`)).json();
  assert.ok(status.missing.length > 0);
  const rejected = await post(`/revisions/${revision.id}/publish`, {});
  assert.equal(rejected.status, 422);
  assert.equal((await rejected.json()).error.code, "RevisionNotPublishable");
});

test("unknown groups and unmapped files do not leak fixture data", async () => {
  assert.equal((await get("/groups/unknown/manifest")).status, 404);
  assert.equal((await get("/derived/not-in-manifest")).status, 404);
  assert.equal((await post("/groups/unknown/artworks", { title: "No access" })).status, 403);
});

test("analytics event IDs are idempotent", async () => {
  const event = { eventId: "evt_contract_test", type: "target_found", groupId: group };
  assert.equal((await (await post("/analytics/events", event)).json()).accepted, 1);
  const duplicate = await (await post("/analytics/events", event)).json();
  assert.equal(duplicate.acceptedEvents[0].duplicate, true);
});

test("malformed JSON yields a client error and the server remains available", async () => {
  const response = await get("/artworks", { method: "POST", body: "{broken" });
  assert.equal(response.status, 400);
  assert.equal((await get("/health")).status, 200);
});
