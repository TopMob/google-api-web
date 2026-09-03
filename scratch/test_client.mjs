async function test(name, baseURL) {
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer sk-personal-gw" },
      body: JSON.stringify({ model: "gemini-3.7-flash", messages: [{ role: "user", content: "hi" }] })
    });
    console.log(`${name}: URL="${baseURL}/chat/completions" -> HTTP ${res.status} ${res.statusText}`);
  } catch (e) {
    console.log(`${name}: URL="${baseURL}/chat/completions" -> FAILED: ${e.message}`);
  }
}
async function run() {
  await test("TEST 1 (gateway with /v1)", "http://127.0.0.1:8081/v1");
  await test("TEST 2 (gateway without /v1)", "http://127.0.0.1:8081");
  await test("TEST 3 (web UI port with /v1)", "http://127.0.0.1:3000/v1");
  await test("TEST 4 (web UI port without /v1)", "http://127.0.0.1:3000");
  await test("TEST 5 (default G4F port)", "http://127.0.0.1:1337/v1");
}
run();
