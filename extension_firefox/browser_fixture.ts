// Reuse the owning VIA mobile fixture against the generated Firefox scripts and
// async browser API mock. Disposable headless Chrome is source/bridge evidence,
// never an installed Firefox, real account or physical phone acceptance claim.
const project = new URL("../../", import.meta.url);
const local = new URL("Local/firefox-android/fixture/", project);
await Deno.mkdir(local, { recursive: true });
const original = await Deno.readTextFile(
  new URL(
    "module_extensions/mastermind_capture/via/script/browser_fixture.ts",
    project,
  ),
);
const start = original.indexOf("const originalScript =");
const end = original.indexOf("// Select X's adapter");
if (start < 0 || end <= start) {
  throw new Error("Owning fixture input contract changed");
}
const mock =
  "globalThis.browser={storage:{local:{get:async(key)=>({[key]:fixtureStore[key]}),set:async(values)=>{Object.assign(fixtureStore,structuredClone(values));}}},runtime:{sendMessage:async(message)=>{if(message.type!=='prometheus.firefox.clipboard.v1')throw Error('Wrong clipboard bridge message');fixtureClipboard.push(message.text);return {ok:true};}}};";
const oldMocks = [
  "globalThis.GM_getValue=(key,fallback)=>fixtureStore[key]??fallback;",
  "globalThis.GM_setValue=(key,value)=>{fixtureStore[key]=value};",
  "globalThis.GM_setClipboard=(value)=>{fixtureClipboard.push(value)};",
];
for (const slug of ["bookmark", "calmly"]) {
  const candidate = new URL(
    `Local/firefox-android/candidate/${slug}/`,
    project,
  );
  const script = await Deno.readTextFile(new URL("bridge.js", candidate)) +
    "\n" +
    await Deno.readTextFile(new URL("source.js", candidate));
  let harness = original.slice(0, start) +
    `const originalScript = ${JSON.stringify(script)};\n` + original.slice(end);
  for (const [index, old] of oldMocks.entries()) {
    if (!harness.includes(JSON.stringify(old))) {
      throw new Error("Owning fixture mock contract changed");
    }
    harness = harness.replace(
      JSON.stringify(old),
      JSON.stringify(index === 0 ? mock : ""),
    );
  }
  const file = new URL(`${slug}-generated-fixture.ts`, local);
  await Deno.writeTextFile(file, harness);
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "-A",
      file.pathname,
      new URL(`${slug}.png`, local).pathname,
      ...(slug === "calmly" ? ["--calmly"] : []),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const output = new TextDecoder().decode(result.stdout);
  const errors = new TextDecoder().decode(result.stderr);
  await Deno.writeTextFile(new URL(`${slug}.log`, local), output + errors);
  if (!result.success) {
    throw new Error(`${slug} bridge fixture failed: ${errors}`);
  }
  console.log(output);
}
