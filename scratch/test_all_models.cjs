const { OpenAIClient } = require("E:/progs/Translator++/www/addons/openai/Engine/openai.js");

async function testAllModels() {
  const client = new OpenAIClient({
    baseURL: "http://127.0.0.1:8081/v1",
    apiKey: "sk-personal-gw"
  });

  const textsToTranslate = [
    "Hey! What are you doing here alone?",
    "I was waiting for you, [Player.Name]! (locked)",
    "Don't worry, everything is going to be just fine.",
    "[[Let's go back to the club]"
  ];

  const models = ["gemini-3.1-pro", "gemini-3.5-flash", "gemini-flash-lite", "gemini-3.7-flash"];

  for (const model of models) {
    console.log(`\n--- Model: ${model} ---`);
    const start = Date.now();
    try {
      const res = await client.generate(textsToTranslate, model, "Russian");
      const elapsed = Date.now() - start;
      console.log(`Success in ${elapsed}ms:`);
      res.forEach((t, i) => console.log(`  [${i}]: ${t}`));
    } catch (e) {
      console.error(`Failed with ${model}:`, e.message);
    }
  }
}

testAllModels();
